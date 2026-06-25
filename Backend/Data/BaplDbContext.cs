using BGL_BT_App.Backend.Models;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Data;

public class BaplDbContext : DbContext
{
    public BaplDbContext(DbContextOptions<BaplDbContext> options) : base(options) { }

    public DbSet<ErpDealerMaster>  DealerMasters  { get; set; }
    public DbSet<ErpRetailBilling> RetailBillings { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Read-only ERP — no migrations, no key generation
        modelBuilder.Entity<ErpDealerMaster>(e =>
        {
            e.ToTable("C_CustomerMaster");   // ← change to your actual table name
            e.HasKey(d => d.CustomerCode);
        });

        modelBuilder.Entity<ErpRetailBilling>(e =>
        {
            e.ToTable("RetailBilling");    // ← change to your actual table name
            e.HasKey(r => r.BillingId);
        });

        base.OnModelCreating(modelBuilder);
    }
}