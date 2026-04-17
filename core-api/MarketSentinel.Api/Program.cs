using MarketSentinel.Api.Consumers;
using MarketSentinel.Api.Data;
using MassTransit;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddCors(options =>
    options.AddPolicy("AllowAll", p =>
        p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

// EF Core + PostgreSQL
builder.Services.AddDbContext<MarketDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

// Redis
builder.Services.AddSingleton<IConnectionMultiplexer>(sp =>
    ConnectionMultiplexer.Connect(
        builder.Configuration.GetConnectionString("Redis") ?? "localhost:6379"));

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
            h.Username("guest");
            h.Password("guest");
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
        ";
        await cmd.ExecuteNonQueryAsync();
    }
    catch (Exception ex)
    {
        Console.WriteLine($"DB init: {ex.Message}");
    }
}

app.UseCors("AllowAll");
app.MapControllers();
app.Run();
