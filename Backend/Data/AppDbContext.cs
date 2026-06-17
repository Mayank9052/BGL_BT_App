using BGL_BT_App.Backend.Models;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<UserSession> UserSessions => Set<UserSession>();

    public DbSet<Proposal> Proposals => Set<Proposal>();
    public DbSet<ProposalActivity> ProposalActivities => Set<ProposalActivity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Users
        modelBuilder.Entity<User>(e =>
        {
            e.ToTable("Users");
            e.HasKey(u => u.Id);
            e.Property(u => u.AzureObjectId).HasMaxLength(100).IsRequired();
            e.HasIndex(u => u.AzureObjectId).IsUnique();
            e.Property(u => u.Email).HasMaxLength(255).IsRequired();
            e.HasIndex(u => u.Email).IsUnique();
            e.Property(u => u.DisplayName).HasMaxLength(255).IsRequired();
            e.Property(u => u.Role).HasMaxLength(50).HasDefaultValue("User");
            e.Property(u => u.CreatedAt).HasDefaultValueSql("GETUTCDATE()");
            e.Property(u => u.UpdatedAt).HasDefaultValueSql("GETUTCDATE()");
        });

        // UserSessions
        modelBuilder.Entity<UserSession>(e =>
        {
            e.ToTable("UserSessions");
            e.HasKey(s => s.Id);
            e.HasOne(s => s.User)
             .WithMany(u => u.Sessions)
             .HasForeignKey(s => s.UserId);
            e.Property(s => s.LoginAt).HasDefaultValueSql("GETUTCDATE()");
        });

        // Proposals
        modelBuilder.Entity<Proposal>(e =>
        {
            e.ToTable("Proposals");
            e.HasKey(p => p.Id);
            e.Property(p => p.SubmittedBy).HasMaxLength(200).IsRequired();
            e.Property(p => p.TotalBudget).HasPrecision(18, 2);
            e.Property(p => p.Cac).HasPrecision(18, 2);
            e.Property(p => p.CreatedAt).HasDefaultValueSql("SYSUTCDATETIME()");

            e.HasMany(p => p.Activities)
            .WithOne(a => a.Proposal!)
            .HasForeignKey(a => a.ProposalId)
            .OnDelete(DeleteBehavior.Cascade);
        });

        // ProposalActivities
        modelBuilder.Entity<ProposalActivity>(e =>
        {
            e.ToTable("ProposalActivities");
            e.HasKey(a => a.Id);
            e.Property(a => a.ActivityType).HasMaxLength(100);
            e.Property(a => a.Budget).HasPrecision(18, 2);
            e.Property(a => a.Incentive).HasPrecision(18, 2);
        });
    }
}