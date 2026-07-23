using MarketSentinel.Api.Consumers;
using MarketSentinel.Api.Data;
using MassTransit;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Oracle admin proxy için HttpClient
builder.Services.AddHttpClient("oracle-admin", client =>
{
    client.Timeout = TimeSpan.FromMinutes(2);
});

// Market-data chart proxy için HttpClient
builder.Services.AddHttpClient("market-data-chart", client =>
{
    var baseUrl = builder.Configuration["MarketData:ChartUrl"] ?? "http://market-data-service:5002";
    client.BaseAddress = new Uri(baseUrl);
    client.Timeout = TimeSpan.FromSeconds(30);
});

// CORS — Production'da yalnızca yapılandırılmış origin'lerden istek kabul edilir.
// docker-compose'da Cors__AllowedOrigins ortam değişkeni ile yapılandırılır.
var allowedOrigins = (builder.Configuration["Cors:AllowedOrigins"] ?? "http://localhost:3000")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

builder.Services.AddCors(options =>
    options.AddPolicy("ConfiguredOrigins", p =>
        p.WithOrigins(allowedOrigins)
         .AllowAnyMethod()
         .AllowAnyHeader()));

// EF Core + PostgreSQL
builder.Services.AddDbContext<MarketDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

// Redis — lazy singleton: bağlantı ilk kullanımda kurulur, startup'ı bloklamaz
builder.Services.AddSingleton<IConnectionMultiplexer>(sp =>
{
    var connStr = builder.Configuration.GetConnectionString("Redis") ?? "localhost:6379";
    var config = ConfigurationOptions.Parse(connStr);
    config.AbortOnConnectFail = false;   // bağlanamasa crash etme
    config.ConnectRetry = 5;
    config.ConnectTimeout = 3000;
    config.AsyncTimeout = 3000;
    config.SyncTimeout = 3000;
    return ConnectionMultiplexer.Connect(config);
});

// MassTransit + RabbitMQ
builder.Services.AddMassTransit(x =>
{
    x.AddConsumer<AnalyzedNewsConsumer>();
    x.AddConsumer<MarketDataConsumer>();
    x.AddConsumer<OracleAnalysisConsumer>();
    x.AddConsumer<FundamentalDataConsumer>();
    x.AddConsumer<OracleStatusConsumer>();

    x.UsingRabbitMq((context, cfg) =>
    {
        cfg.Host(builder.Configuration["RabbitMq:Host"] ?? "localhost", "/", h =>
        {
            h.Username(builder.Configuration["RabbitMq:Username"] ?? "guest");
            h.Password(builder.Configuration["RabbitMq:Password"] ?? "guest");
        });

        cfg.UseRawJsonSerializer();

        cfg.ReceiveEndpoint("news.analyzed", e =>
            e.ConfigureConsumer<AnalyzedNewsConsumer>(context));

        cfg.ReceiveEndpoint("market.data", e =>
            e.ConfigureConsumer<MarketDataConsumer>(context));

        cfg.ReceiveEndpoint("oracle.analysis", e =>
            e.ConfigureConsumer<OracleAnalysisConsumer>(context));

        cfg.ReceiveEndpoint("fundamental.data", e =>
            e.ConfigureConsumer<FundamentalDataConsumer>(context));

        cfg.ReceiveEndpoint("oracle.status", e =>
            e.ConfigureConsumer<OracleStatusConsumer>(context));
    });
});

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

// Veritabanı şemasını oluştur / yeni tabloları ekle
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<MarketDbContext>();
    try
    {
        db.Database.EnsureCreated();

        var conn = db.Database.GetDbConnection();
        await conn.OpenAsync();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            CREATE TABLE IF NOT EXISTS ""PriceData"" (
                ""Id""            UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
                ""Symbol""        VARCHAR(20)   NOT NULL,
                ""AssetType""     VARCHAR(20)   NOT NULL,
                ""Close""         DOUBLE PRECISION,
                ""Open""          DOUBLE PRECISION,
                ""High""          DOUBLE PRECISION,
                ""Low""           DOUBLE PRECISION,
                ""Volume""        DOUBLE PRECISION,
                ""Rsi""           DOUBLE PRECISION,
                ""MacdLine""      DOUBLE PRECISION,
                ""MacdSignal""    DOUBLE PRECISION,
                ""MacdHistogram"" DOUBLE PRECISION,
                ""BbUpper""       DOUBLE PRECISION,
                ""BbMiddle""      DOUBLE PRECISION,
                ""BbLower""       DOUBLE PRECISION,
                ""Ema9""          DOUBLE PRECISION,
                ""Ema20""         DOUBLE PRECISION,
                ""Ema50""         DOUBLE PRECISION,
                ""Ema200""        DOUBLE PRECISION,
                ""Signal""        VARCHAR(10)   NOT NULL DEFAULT 'NEUTRAL',
                ""SignalStrength"" DOUBLE PRECISION NOT NULL DEFAULT 0,
                ""RecordedAt""    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_pricedata_symbol_recorded
                ON ""PriceData"" (""Symbol"", ""RecordedAt"");

            CREATE TABLE IF NOT EXISTS ""OracleAnalyses"" (
                ""Id""               UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
                ""Symbol""           VARCHAR(20)   NOT NULL,
                ""AssetType""        VARCHAR(20)   NOT NULL DEFAULT '',
                ""PriceAtAnalysis""  DOUBLE PRECISION,
                ""Recommendation""   VARCHAR(20)   NOT NULL DEFAULT 'NÖTR',
                ""Confidence""       DOUBLE PRECISION NOT NULL DEFAULT 0,
                ""ShortTermBias""    VARCHAR(20)   NOT NULL DEFAULT 'YATAY',
                ""ShortTermTarget""  DOUBLE PRECISION,
                ""ShortTermStop""    DOUBLE PRECISION,
                ""LongTermBias""     VARCHAR(20)   NOT NULL DEFAULT 'YATAY',
                ""LongTermTarget""   DOUBLE PRECISION,
                ""Reasoning""        TEXT          NOT NULL DEFAULT '',
                ""KeyDrivers""       TEXT          NOT NULL DEFAULT '[]',
                ""Risks""            TEXT          NOT NULL DEFAULT '[]',
                ""WatchPoints""      TEXT          NOT NULL DEFAULT '[]',
                ""TechnicalScore""   DOUBLE PRECISION NOT NULL DEFAULT 0,
                ""NewsScore""        DOUBLE PRECISION NOT NULL DEFAULT 0,
                ""MacroScore""       DOUBLE PRECISION NOT NULL DEFAULT 0,
                ""AnalyzedAt""       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_oracle_symbol_analyzed
                ON ""OracleAnalyses"" (""Symbol"", ""AnalyzedAt"");

            -- MarketSignals: model güncellemesiyle eklenen kolonlar (varsa atla)
            ALTER TABLE ""MarketSignals"" ADD COLUMN IF NOT EXISTS ""Headline""       TEXT NOT NULL DEFAULT '';
            ALTER TABLE ""MarketSignals"" ADD COLUMN IF NOT EXISTS ""Url""            TEXT NOT NULL DEFAULT '';
            ALTER TABLE ""MarketSignals"" ADD COLUMN IF NOT EXISTS ""SentimentLabel"" TEXT NOT NULL DEFAULT 'NEUTRAL';
            ALTER TABLE ""MarketSignals"" ADD COLUMN IF NOT EXISTS ""IsGeopolitical"" BOOLEAN NOT NULL DEFAULT FALSE;
            -- Eski Disclaimer kolonu modelden kaldırıldı; INSERT başarısız olmaması için default ver.
            -- DİKKAT: Taze DB'de bu kolon hiç yoktur — koşulsuz ALTER tüm bloğu geri sardırıyordu
            -- (07/2026'da tespit edildi: hata 42703 → hiçbir migrasyon uygulanmıyordu).
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'MarketSignals' AND column_name = 'Disclaimer') THEN
                    ALTER TABLE ""MarketSignals"" ALTER COLUMN ""Disclaimer"" SET DEFAULT '';
                END IF;
            END $$;

            -- Faz 1 (ml v4 yol haritası — 07/2026): point-in-time haber deposu
            -- PublishedAt = event_ts, CreatedAt = ingest_ts (as-of join CreatedAt'ten)
            ALTER TABLE ""MarketSignals"" ADD COLUMN IF NOT EXISTS ""PublishedAt""  TIMESTAMPTZ;
            ALTER TABLE ""MarketSignals"" ADD COLUMN IF NOT EXISTS ""NewsGuid""     TEXT NOT NULL DEFAULT '';
            ALTER TABLE ""MarketSignals"" ADD COLUMN IF NOT EXISTS ""SentimentRaw"" DOUBLE PRECISION NOT NULL DEFAULT 0;
            ALTER TABLE ""MarketSignals"" ADD COLUMN IF NOT EXISTS ""SourceWeight"" DOUBLE PRECISION NOT NULL DEFAULT 1;
            ALTER TABLE ""MarketSignals"" ADD COLUMN IF NOT EXISTS ""Lang""         VARCHAR(8) NOT NULL DEFAULT '';
            CREATE INDEX IF NOT EXISTS idx_marketsignal_newsguid
                ON ""MarketSignals"" (""NewsGuid"");

            -- Faz 3 (ml v4 — 07/2026): olay tipolojisi + yenilik skoru
            ALTER TABLE ""MarketSignals"" ADD COLUMN IF NOT EXISTS ""EventType"" VARCHAR(32) NOT NULL DEFAULT 'GENEL';
            ALTER TABLE ""MarketSignals"" ADD COLUMN IF NOT EXISTS ""Novelty""   DOUBLE PRECISION NOT NULL DEFAULT 1;

            -- Faz 2: OracleAnalyses'e FundamentalScore kolonu ekle (varsa atla)
            ALTER TABLE ""OracleAnalyses""
                ADD COLUMN IF NOT EXISTS ""FundamentalScore"" DOUBLE PRECISION NOT NULL DEFAULT 0;

            -- Faz 3: Mevcut FundamentalData tablosuna FAVÖK kolonlarını ekle (varsa atla)
            ALTER TABLE ""FundamentalData"" ADD COLUMN IF NOT EXISTS ""Ebitda""        DOUBLE PRECISION;
            ALTER TABLE ""FundamentalData"" ADD COLUMN IF NOT EXISTS ""EbitdaMargin""  DOUBLE PRECISION;
            ALTER TABLE ""FundamentalData"" ADD COLUMN IF NOT EXISTS ""NetDebtEbitda"" DOUBLE PRECISION;
            ALTER TABLE ""FundamentalData"" ADD COLUMN IF NOT EXISTS ""TcmbRatePct""   DOUBLE PRECISION;

            -- Faz 2: FundamentalData tablosu
            CREATE TABLE IF NOT EXISTS ""FundamentalData"" (
                ""Id""               UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
                ""Symbol""           VARCHAR(20)   NOT NULL,
                ""AssetType""        VARCHAR(20)   NOT NULL DEFAULT '',
                ""CompanyName""      VARCHAR(200)  NOT NULL DEFAULT '',
                ""Sector""           VARCHAR(100)  NOT NULL DEFAULT '',
                ""PeRatio""          DOUBLE PRECISION,
                ""ForwardPe""        DOUBLE PRECISION,
                ""PbRatio""          DOUBLE PRECISION,
                ""Roe""              DOUBLE PRECISION,
                ""Eps""              DOUBLE PRECISION,
                ""ForwardEps""       DOUBLE PRECISION,
                -- FAVÖK / Operasyonel Karlılık (Faz 3 eklentisi)
                ""Ebitda""           DOUBLE PRECISION,
                ""EbitdaMargin""     DOUBLE PRECISION,
                ""NetDebtEbitda""    DOUBLE PRECISION,
                ""TcmbRatePct""      DOUBLE PRECISION,
                ""DebtToEquity""     DOUBLE PRECISION,
                ""Beta""             DOUBLE PRECISION,
                ""RevenueGrowth""    DOUBLE PRECISION,
                ""EarningsGrowth""   DOUBLE PRECISION,
                ""DividendYield""    DOUBLE PRECISION,
                ""MarketCap""        DOUBLE PRECISION,
                ""Position52W""      DOUBLE PRECISION,
                ""FundamentalScore"" DOUBLE PRECISION NOT NULL DEFAULT 0,
                ""LastKapTitle""     TEXT          NOT NULL DEFAULT '',
                ""LastKapDate""      VARCHAR(60)   NOT NULL DEFAULT '',
                ""UpdatedAt""        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_fundamental_symbol_updated
                ON ""FundamentalData"" (""Symbol"", ""UpdatedAt"");

            -- Audit 05/2026: OracleAnalyses risk yönetimi kolonları
            ALTER TABLE ""OracleAnalyses""
                ADD COLUMN IF NOT EXISTS ""PositionSizePct"" DOUBLE PRECISION;
            ALTER TABLE ""OracleAnalyses""
                ADD COLUMN IF NOT EXISTS ""RiskRewardRatio"" DOUBLE PRECISION;

            -- ── Portföy Modülü (Faz 1 — 05/2026) ──────────────────────────────
            CREATE TABLE IF NOT EXISTS ""PortfolioPositions"" (
                ""Id""               UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
                ""Symbol""           VARCHAR(20)   NOT NULL,
                ""BuyPrice""         NUMERIC(18,4) NOT NULL,
                ""Quantity""         NUMERIC(18,4) NOT NULL,
                ""BuyDate""          TIMESTAMPTZ   NOT NULL,
                ""BuyCommission""    NUMERIC(18,4) NOT NULL DEFAULT 0,
                ""Status""           VARCHAR(20)   NOT NULL DEFAULT 'OPEN',
                ""ClosePrice""       NUMERIC(18,4),
                ""CloseDate""        TIMESTAMPTZ,
                ""CloseCommission""  NUMERIC(18,4),
                ""CloseReason""      VARCHAR(40),
                ""RealizedPnl""      NUMERIC(18,4),
                ""Notes""            TEXT,
                ""CreatedAt""        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
                ""UpdatedAt""        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_portfolio_symbol_status
                ON ""PortfolioPositions"" (""Symbol"", ""Status"");

            CREATE TABLE IF NOT EXISTS ""Dividends"" (
                ""Id""             UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
                ""Symbol""         VARCHAR(20)   NOT NULL,
                ""PaymentDate""    TIMESTAMPTZ   NOT NULL,
                ""AmountPerShare"" NUMERIC(18,4) NOT NULL,
                ""TotalAmount""    NUMERIC(18,4) NOT NULL,
                ""Notes""          TEXT,
                ""CreatedAt""      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_dividend_symbol_date
                ON ""Dividends"" (""Symbol"", ""PaymentDate"");
        ";
        await cmd.ExecuteNonQueryAsync();
    }
    catch (Exception ex)
    {
        Console.WriteLine($"DB init: {ex.Message}");
    }
}

app.UseCors("ConfiguredOrigins");

// ── Admin API Key Middleware ─────────────────────────────────────────────────
// /api/admin/* yolundaki tüm endpoint'ler X-Admin-Key header'ı ile korunur.
// Anahtar docker-compose üzerinden Admin__ApiKey ortam değişkeni ile sağlanır.
var adminApiKey = app.Configuration["Admin:ApiKey"] ?? "";
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.StartsWithSegments("/api/admin"))
    {
        if (string.IsNullOrEmpty(adminApiKey))
        {
            ctx.Response.StatusCode = 503;
            await ctx.Response.WriteAsJsonAsync(new { error = "Admin API anahtarı yapılandırılmamış" });
            return;
        }
        var key = ctx.Request.Headers["X-Admin-Key"].ToString();
        if (key != adminApiKey)
        {
            ctx.Response.StatusCode = 401;
            await ctx.Response.WriteAsJsonAsync(new { error = "Geçersiz veya eksik X-Admin-Key" });
            return;
        }
    }
    await next();
});

app.MapControllers();

// Sağlık kontrolü endpoint'i — frontend "hazır mı?" diye sorar
app.MapGet("/health", () => Results.Ok(new { status = "ok", ts = DateTime.UtcNow }));

app.Run();
