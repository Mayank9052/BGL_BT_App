using BGL_BT_App.Backend.Models;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    // ── Existing tables ───────────────────────────────────────────────────────
    public DbSet<User>             Users              => Set<User>();
    public DbSet<UserSession>      UserSessions       => Set<UserSession>();
    public DbSet<Proposal>         Proposals          => Set<Proposal>();
    public DbSet<ProposalActivity> ProposalActivities => Set<ProposalActivity>();
    public DbSet<ActivityMedia>    ActivityMediaFiles => Set<ActivityMedia>();
    public DbSet<State>            States             => Set<State>();
    public DbSet<City>             Cities             => Set<City>();
    public DbSet<ApprovalDecision> ApprovalDecisions  => Set<ApprovalDecision>();
    public DbSet<ActivityMaster>   ActivityMasters    => Set<ActivityMaster>();
    public DbSet<VendorMaster>     VendorMasters      => Set<VendorMaster>();

    // ── Chat tables (added for in-app messaging + AI bot) ─────────────────────
    public DbSet<ChatRoom>       ChatRooms       => Set<ChatRoom>();
    public DbSet<ChatRoomMember> ChatRoomMembers => Set<ChatRoomMember>();
    public DbSet<ChatMessage>    ChatMessages    => Set<ChatMessage>();
    public DbSet<WhatsAppMessage> WhatsAppMessages => Set<WhatsAppMessage>();
    public DbSet<BotKnowledge>    BotKnowledgeBase  => Set<BotKnowledge>();
    public DbSet<ProposalAiReview> ProposalAiReviews => Set<ProposalAiReview>();
    public DbSet<ProposalAiFlag>   ProposalAiFlags    => Set<ProposalAiFlag>();
    public DbSet<LmsLeadRecord> LmsLeadRecords => Set<LmsLeadRecord>();
    public DbSet<LeadChannelMapping> LeadChannelMappings => Set<LeadChannelMapping>();
    public DbSet<LeadTarget> LeadTargets => Set<LeadTarget>();


    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // ── Users ─────────────────────────────────────────────────────────────
        modelBuilder.Entity<User>(e =>
        {
            e.ToTable("Users");
            e.HasKey(u => u.Id);
            e.Property(u => u.AzureObjectId).HasMaxLength(100).IsRequired(false);
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

        // ── UserSessions ──────────────────────────────────────────────────────
        modelBuilder.Entity<UserSession>(e =>
        {
            e.ToTable("UserSessions");
            e.HasKey(s => s.Id);
            e.HasOne(s => s.User).WithMany(u => u.Sessions).HasForeignKey(s => s.UserId);
            e.Property(s => s.LoginAt).HasDefaultValueSql("GETUTCDATE()");
        });

        // ── Proposals ─────────────────────────────────────────────────────────
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

        // ── ProposalActivities ────────────────────────────────────────────────
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

        // ── ActivityMedia ─────────────────────────────────────────────────────
        modelBuilder.Entity<ActivityMedia>(e =>
        {
            e.ToTable("ActivityMedia");
            e.HasKey(m => m.Id);
            e.Property(m => m.FileUrl).HasMaxLength(500).IsRequired();
            e.Property(m => m.FileName).HasMaxLength(255).IsRequired();
            e.Property(m => m.FileType).HasMaxLength(100).IsRequired();
            e.Property(m => m.UploadedAt).HasDefaultValueSql("GETDATE()");
        });

        // ── ApprovalDecisions ─────────────────────────────────────────────────
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

        // ── ActivityMaster ────────────────────────────────────────────────────
        modelBuilder.Entity<ActivityMaster>(e =>
        {
            e.ToTable("ActivityMaster");
            e.HasKey(a => a.Id);
            e.Property(a => a.ActivityName).HasMaxLength(100).IsRequired();
            e.HasIndex(a => a.ActivityName).IsUnique();
            e.Property(a => a.CreatedAt).HasDefaultValueSql("GETDATE()");
        });

        // ── VendorMaster ──────────────────────────────────────────────────────
        modelBuilder.Entity<VendorMaster>(e =>
        {
            e.ToTable("VendorMaster");
            e.HasKey(v => v.Id);
            e.Property(v => v.VendorName).HasMaxLength(200).IsRequired();
            e.Property(v => v.CreatedAt).HasDefaultValueSql("GETDATE()");
        });

        // ── Location ──────────────────────────────────────────────────────────
        modelBuilder.Entity<City>()
            .HasOne(c => c.State).WithMany(s => s.Cities)
            .HasForeignKey(c => c.StateId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<City>()
            .HasIndex(c => new { c.StateId, c.Name }).IsUnique();

        // ── Chat ──────────────────────────────────────────────────────────────
        modelBuilder.Entity<ChatRoom>(e =>
        {
            e.ToTable("ChatRooms");
            e.HasKey(r => r.Id);
            e.Property(r => r.RoomType).HasMaxLength(20).HasDefaultValue("direct");
            e.Property(r => r.CreatedAt).HasDefaultValueSql("SYSDATETIMEOFFSET()");
        });

        modelBuilder.Entity<ChatRoomMember>(e =>
        {
            e.ToTable("ChatRoomMembers");
            e.HasKey(m => m.Id);
            e.Property(m => m.Email).HasMaxLength(255).IsRequired();
            e.HasOne(m => m.Room)
             .WithMany(r => r.Members)
             .HasForeignKey(m => m.RoomId)
             .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(m => m.RoomId);
            e.HasIndex(m => m.Email);
        });

        modelBuilder.Entity<ChatMessage>(e =>
        {
            e.ToTable("ChatMessages");
            e.HasKey(m => m.Id);
            e.Property(m => m.SenderEmail).HasMaxLength(255).IsRequired();
            e.Property(m => m.SenderName).HasMaxLength(255).IsRequired();
            e.Property(m => m.IsBot).HasDefaultValue(false);
            e.Property(m => m.SentAt).HasDefaultValueSql("SYSDATETIMEOFFSET()");
            e.HasOne(m => m.Room)
             .WithMany(r => r.Messages)
             .HasForeignKey(m => m.RoomId)
             .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(m => m.RoomId);
            e.HasIndex(m => m.SentAt);
        });

        // ── Bot Knowledge Base ───────────────────────────────────────────────
        modelBuilder.Entity<BotKnowledge>(e =>
        {
            e.ToTable("BotKnowledge");
            e.HasKey(b => b.Id);
            e.Property(b => b.Category).HasMaxLength(100).IsRequired();
            e.Property(b => b.Question).HasMaxLength(500).IsRequired();
            e.Property(b => b.Keywords).HasMaxLength(1000).IsRequired();
            e.Property(b => b.IsActive).HasDefaultValue(true);
            e.Property(b => b.CreatedAt).HasDefaultValueSql("GETUTCDATE()");
            e.HasIndex(b => b.Category);
            e.HasIndex(b => b.IsActive);
        });

        // ── WhatsApp Messages ─────────────────────────────────────────────────
        modelBuilder.Entity<WhatsAppMessage>(e =>
        {
            e.ToTable("WhatsAppMessages");
            e.HasKey(m => m.Id);
            e.Property(m => m.SentByEmail).HasMaxLength(255).IsRequired();
            e.Property(m => m.SentByName).HasMaxLength(255).IsRequired();
            e.Property(m => m.ToPhone).HasMaxLength(30).IsRequired();
            e.Property(m => m.ContactName).HasMaxLength(255);
            e.Property(m => m.MessageType).HasMaxLength(20).HasDefaultValue("text");
            e.Property(m => m.Direction).HasMaxLength(10).HasDefaultValue("outbound");
            e.Property(m => m.WaMessageId).HasMaxLength(255);
            e.Property(m => m.Status).HasMaxLength(30).HasDefaultValue("sent");
            e.Property(m => m.ErrorMessage).HasMaxLength(500);
            e.Property(m => m.SentAt).HasDefaultValueSql("SYSDATETIMEOFFSET()");
            e.HasIndex(m => m.ToPhone);
            e.HasIndex(m => m.SentAt);
            e.HasIndex(m => m.WaMessageId).HasFilter("[WaMessageId] IS NOT NULL");
        });

        modelBuilder.Entity<ProposalAiReview>(e =>
        {
            e.ToTable("ProposalAiReviews");
            e.HasKey(r => r.Id);
            e.Property(r => r.RunAt).HasDefaultValueSql("SYSDATETIMEOFFSET()");
            e.HasOne(r => r.Proposal).WithMany()
            .HasForeignKey(r => r.ProposalId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(r => r.ProposalId);
            e.HasMany(r => r.Flags).WithOne(f => f.Review!)
            .HasForeignKey(f => f.ReviewId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ProposalAiFlag>(e =>
        {
            e.ToTable("ProposalAiFlags");
            e.HasKey(f => f.Id);
            e.Property(f => f.Severity).HasMaxLength(20).IsRequired();
            e.Property(f => f.Title).HasMaxLength(150).IsRequired();
            e.Property(f => f.Detail).HasMaxLength(1000).IsRequired();
            e.Property(f => f.RelatedActivityType).HasMaxLength(100);
            e.HasOne(f => f.Review).WithMany(r => r.Flags)
             .HasForeignKey(f => f.ReviewId).OnDelete(DeleteBehavior.Cascade);
        }); 
        
        // ── LMS Lead Records ───────────────────────────────────────────────────
        modelBuilder.Entity<LmsLeadRecord>(e =>
        {
            e.ToTable("LmsLeadRecords");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id)
                .HasDefaultValueSql("NEWID()");
            e.Property(x => x.ApplicationId)
                .HasMaxLength(100);
            e.Property(x => x.SrNo);
            e.Property(x => x.UniqueLeadId)
                .IsRequired();
            e.HasIndex(x => x.UniqueLeadId)
                .IsUnique()
                .HasDatabaseName("UX_LmsLeadRecords_UniqueLeadId");
            e.Property(x => x.ZH).HasMaxLength(150);
            e.Property(x => x.RSM).HasMaxLength(150);
            e.Property(x => x.TSM).HasMaxLength(150);
            e.Property(x => x.Commando).HasMaxLength(150);
            e.Property(x => x.DealerCode)
                .HasMaxLength(50);
            e.Property(x => x.OrganizationName)
                .HasMaxLength(300);
            e.Property(x => x.DealerPinCode)
                .HasMaxLength(20);
            e.Property(x => x.CustomerName)
                .HasMaxLength(200);
            e.Property(x => x.Mobile)
                .HasMaxLength(20);
            e.Property(x => x.Email)
                .HasMaxLength(200);
            e.Property(x => x.Source)
                .HasMaxLength(100);
            e.Property(x => x.SubSource)
                .HasMaxLength(100);
            e.Property(x => x.LeadOrigin)
                .HasMaxLength(100);
            e.Property(x => x.Make)
                .HasMaxLength(100);
            e.Property(x => x.Model)
                .HasMaxLength(100);
            e.Property(x => x.Version)
                .HasMaxLength(100);
            e.Property(x => x.LeadDate);
            e.Property(x => x.City)
                .HasMaxLength(150);
            e.Property(x => x.State)
                .HasMaxLength(100);
            e.Property(x => x.CustomerPinCode)
                .HasMaxLength(20);
            e.Property(x => x.User)
                .HasMaxLength(150);
            e.Property(x => x.Stage)
                .HasMaxLength(100);
            e.Property(x => x.SubStage)
                .HasMaxLength(100);
            e.Property(x => x.QualifiedBy)
                .HasMaxLength(150);
            e.Property(x => x.LostClosedReason)
                .HasMaxLength(200);
            e.Property(x => x.LostClosedSubReason)
                .HasMaxLength(200);
            e.Property(x => x.LostClosedBy)
                .HasMaxLength(150);
            e.Property(x => x.LeadStatus)
                .HasMaxLength(100);
            e.Property(x => x.LeadStatusUpdationDate);
            e.Property(x => x.Eagerness)
                .HasMaxLength(50);
            e.Property(x => x.LastCallComment)
                .HasMaxLength(500);
            e.Property(x => x.FollowUpDate);
            e.Property(x => x.LastCallDate);
            e.Property(x => x.ScheduleTR)
                .HasMaxLength(10);
            e.Property(x => x.NumberOfAttempts);
            e.Property(x => x.CreatedAt)
                .HasDefaultValueSql("SYSUTCDATETIME()");
            e.Property(x => x.UpdatedAt);
            // Matches:
            // CREATE INDEX IX_LmsLeadRecords_State_Source_SubSource
            e.HasIndex(x => new
            {
                x.State,
                x.Source,
                x.SubSource
            })
            .HasDatabaseName("IX_LmsLeadRecords_State_Source_SubSource");
            // Matches:
            // CREATE INDEX IX_LmsLeadRecords_LeadDate
            e.HasIndex(x => x.LeadDate)
                .HasDatabaseName("IX_LmsLeadRecords_LeadDate");
        });


        // ── Lead Channel Mappings ──────────────────────────────────────────────
        modelBuilder.Entity<LeadChannelMapping>(e =>
        {
            e.ToTable("LeadChannelMappings");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id)
                .HasDefaultValueSql("NEWID()");
            e.Property(x => x.Source)
                .HasMaxLength(100)
                .IsRequired();
            e.Property(x => x.SubSource)
                .HasMaxLength(100);
            e.Property(x => x.Channel)
                .HasMaxLength(20)
                .IsRequired();
            e.Property(x => x.CreatedAt)
                .HasDefaultValueSql("SYSUTCDATETIME()");
            e.HasIndex(x => new
            {
                x.Source,
                x.SubSource
            })
            .IsUnique()
            .HasDatabaseName("UX_LeadChannelMappings");
        });


        // ── Lead Targets ───────────────────────────────────────────────────────
        modelBuilder.Entity<LeadTarget>(e =>
        {
            e.ToTable("LeadTargets");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id)
               .HasDefaultValueSql("NEWID()");
            e.Property(x => x.State)
                .HasMaxLength(100)
                .IsRequired();
            e.Property(x => x.Channel)
                .HasMaxLength(20)
                .IsRequired();
            e.Property(x => x.Month)
                .IsRequired();
            e.Property(x => x.Year)
                .IsRequired();
            e.Property(x => x.TargetValue)
                .HasDefaultValue(0)
                .IsRequired();
            e.Property(x => x.UpdatedBy)
                .HasMaxLength(150);
            e.Property(x => x.UpdatedAt)
                .HasDefaultValueSql("SYSUTCDATETIME()");
            e.HasIndex(x => new
            {
                x.State,
                x.Channel,
                x.Month,
                x.Year
            })
            .IsUnique()
            .HasDatabaseName("UX_LeadTargets");
        });


    }
}