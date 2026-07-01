using BGL_BT_App.Backend.Models;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User>             Users             => Set<User>();
    public DbSet<UserSession>      UserSessions      => Set<UserSession>();
    public DbSet<Proposal>         Proposals         => Set<Proposal>();
    public DbSet<ProposalActivity> ProposalActivities => Set<ProposalActivity>();
    public DbSet<ActivityMedia>    ActivityMediaFiles => Set<ActivityMedia>();
    public DbSet<State>            States            => Set<State>();
    public DbSet<City>             Cities            => Set<City>();
    public DbSet<ApprovalDecision> ApprovalDecisions => Set<ApprovalDecision>();
    public DbSet<ActivityMaster>   ActivityMasters   => Set<ActivityMaster>();
    public DbSet<VendorMaster>     VendorMasters     => Set<VendorMaster>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Users
        modelBuilder.Entity<User>(e =>
        {
            e.ToTable("Users");
            e.HasKey(u => u.Id);

            // AzureObjectId is now NULLABLE — only set for AzureAD-authenticated
            // staff accounts; Dealer (local-auth) accounts leave this null.
            e.Property(u => u.AzureObjectId).HasMaxLength(100).IsRequired(false);

            // Unique index must be FILTERED so multiple NULLs (dealer accounts)
            // don't violate uniqueness — only enforce uniqueness when a value exists.
            e.HasIndex(u => u.AzureObjectId)
             .IsUnique()
             .HasFilter("[AzureObjectId] IS NOT NULL");

            e.Property(u => u.Email).HasMaxLength(255).IsRequired();
            e.HasIndex(u => u.Email).IsUnique();
            e.Property(u => u.DisplayName).HasMaxLength(255).IsRequired();
            e.Property(u => u.Role).HasMaxLength(50).HasDefaultValue("User");
            e.Property(u => u.AuthType).HasMaxLength(20).HasDefaultValue("AzureAD");
            e.Property(u => u.PasswordHash).HasMaxLength(255);
            e.Property(u => u.DealerCode).HasMaxLength(50);
            e.Property(u => u.DealerName).HasMaxLength(200);
            e.Property(u => u.CreatedByEmail).HasMaxLength(255);
            e.Property(u => u.ResetToken).HasMaxLength(255);
            e.Property(u => u.CreatedAt).HasDefaultValueSql("GETUTCDATE()");
            e.Property(u => u.UpdatedAt).HasDefaultValueSql("GETUTCDATE()");
        });

        // UserSessions
        modelBuilder.Entity<UserSession>(e =>
        {
            e.ToTable("UserSessions");
            e.HasKey(s => s.Id);
            e.HasOne(s => s.User).WithMany(u => u.Sessions).HasForeignKey(s => s.UserId);
            e.Property(s => s.LoginAt).HasDefaultValueSql("GETUTCDATE()");
        });

        modelBuilder.Entity<Proposal>(e =>
        {
            e.ToTable("Proposals");
            e.HasKey(p => p.Id);
            e.Property(p => p.SubmittedBy).HasMaxLength(200).IsRequired();
            e.Property(p => p.TotalBudget).HasPrecision(18, 2);
            e.Property(p => p.Cac).HasPrecision(18, 2);
            e.Property(p => p.Cpl).HasPrecision(18, 2);
            e.Property(p => p.AllowedCac).HasDefaultValue(4000);
            e.Property(p => p.CacWarning).HasMaxLength(500);
            e.Property(p => p.CreatedAt).HasDefaultValueSql("SYSUTCDATETIME()");
            e.HasMany(p => p.Activities)
             .WithOne(a => a.Proposal!)
             .HasForeignKey(a => a.ProposalId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ProposalActivity>(e =>
        {
            e.ToTable("ProposalActivities");
            e.HasKey(a => a.Id);
            e.Property(a => a.ActivityType).HasMaxLength(100);
            e.Property(a => a.Budget).HasPrecision(18, 2);
            e.Property(a => a.AdditionalBudget).HasPrecision(18, 2);
            e.Property(a => a.BGaussShare).HasPrecision(5, 2).HasDefaultValue(100m);
            e.HasMany(a => a.MediaFiles)
             .WithOne(m => m.Activity!)
             .HasForeignKey(m => m.ActivityId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ActivityMedia>(e =>
        {
            e.ToTable("ActivityMedia");
            e.HasKey(m => m.Id);
            e.Property(m => m.FileUrl).HasMaxLength(500).IsRequired();
            e.Property(m => m.FileName).HasMaxLength(255).IsRequired();
            e.Property(m => m.FileType).HasMaxLength(100).IsRequired();
            e.Property(m => m.UploadedAt).HasDefaultValueSql("GETDATE()");
        });

        modelBuilder.Entity<ApprovalDecision>(e =>
        {
            e.ToTable("ApprovalDecisions");
            e.HasKey(d => d.Id);
            e.Property(d => d.Status).HasMaxLength(50).IsRequired();
            e.Property(d => d.ApprovedBy).HasMaxLength(200).IsRequired();
            e.Property(d => d.DecidedAt).HasDefaultValueSql("SYSUTCDATETIME()");
            e.HasOne(d => d.Proposal).WithMany()
             .HasForeignKey(d => d.ProposalId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(d => d.ProposalId);
        });

        modelBuilder.Entity<ActivityMaster>(e =>
        {
            e.ToTable("ActivityMaster");
            e.HasKey(a => a.Id);
            e.Property(a => a.ActivityName).HasMaxLength(100).IsRequired();
            e.HasIndex(a => a.ActivityName).IsUnique();
            e.Property(a => a.CreatedAt).HasDefaultValueSql("GETDATE()");
        });

        modelBuilder.Entity<VendorMaster>(e =>
        {
            e.ToTable("VendorMaster");
            e.HasKey(v => v.Id);
            e.Property(v => v.VendorName).HasMaxLength(200).IsRequired();
            e.Property(v => v.CreatedAt).HasDefaultValueSql("GETDATE()");
        });

        modelBuilder.Entity<City>()
            .HasOne(c => c.State).WithMany(s => s.Cities)
            .HasForeignKey(c => c.StateId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<City>()
            .HasIndex(c => new { c.StateId, c.Name }).IsUnique();
    }
}