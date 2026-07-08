// Backend/Models/WhatsAppMessage.cs
namespace BGL_BT_App.Backend.Models;

public class WhatsAppMessage
{
    public Guid   Id           { get; set; } = Guid.NewGuid();
    public string SentByEmail  { get; set; } = string.Empty;
    public string SentByName   { get; set; } = string.Empty;
    public string ToPhone      { get; set; } = string.Empty;   // E.164: +919876543210
    public string? ContactName { get; set; }
    public string Body         { get; set; } = string.Empty;
    public string MessageType  { get; set; } = "text";         // text | template | image
    public string? TemplateName { get; set; }
    public string Direction    { get; set; } = "outbound";     // outbound | inbound
    public string? WaMessageId { get; set; }
    public string Status       { get; set; } = "sent";         // sent|delivered|read|failed
    public string? ErrorMessage { get; set; }
    public DateTimeOffset SentAt      { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? DeliveredAt { get; set; }
    public DateTimeOffset? ReadAt      { get; set; }
}
