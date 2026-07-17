using System.ComponentModel.DataAnnotations;

namespace BGL_BT_App.Backend.Models;

public class ActivityMedia
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ActivityId { get; set; }
    public ProposalActivity? Activity { get; set; }
    [MaxLength(500)] public string FileUrl   { get; set; } = string.Empty;
    [MaxLength(255)] public string FileName  { get; set; } = string.Empty;
    [MaxLength(100)] public string FileType  { get; set; } = string.Empty;
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    public DateTimeOffset? CapturedAt { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public double? LocationAccuracyMeters { get; set; }
}