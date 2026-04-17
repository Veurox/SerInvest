using MarketSentinel.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace MarketSentinel.Api.Data
{
    public class MarketDbContext : DbContext
    {
        public MarketDbContext(DbContextOptions<MarketDbContext> options) : base(options) { }

        public DbSet<MarketSignal>   MarketSignals   { get; set; }
        public DbSet<PriceData>      PriceData       { get; set; }
        public DbSet<OracleAnalysis> OracleAnalyses  { get; set; }
        public DbSet<FundamentalData> FundamentalData { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<PriceData>()
                .HasIndex(p => new { p.Symbol, p.RecordedAt })
                .HasDatabaseName("idx_pricedata_symbol_recorded");

            modelBuilder.Entity<MarketSignal>()
                .HasIndex(s => new { s.Entity, s.CreatedAt })
                .HasDatabaseName("idx_marketsignal_entity_created");

            modelBuilder.Entity<OracleAnalysis>()
                .HasIndex(o => new { o.Symbol, o.AnalyzedAt })
                .HasDatabaseName("idx_oracle_symbol_analyzed");

            modelBuilder.Entity<FundamentalData>()
                .HasIndex(f => new { f.Symbol, f.UpdatedAt })
                .HasDatabaseName("idx_fundamental_symbol_updated");
        }
    }
}
