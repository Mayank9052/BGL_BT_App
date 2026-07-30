// Services/GraphTokenStore.cs
// Singleton that holds the latest Graph token provided by the Checker
// when they call bulk-forward. The DailyDigestService uses this token
// to send the digest email via Microsoft Graph (same as the rest of the app).

namespace BGL_BT_App.Backend.Services;

public class GraphTokenStore
{
    private string? _token;
    private string? _senderEmail;
    private DateTime _storedAt = DateTime.MinValue;

    public void Store(string token, string senderEmail)
    {
        _token       = token;
        _senderEmail = senderEmail;
        _storedAt    = DateTime.UtcNow;
    }

    /// <summary>Returns (token, senderEmail) if stored within the last 55 minutes, else null.</summary>
    public (string Token, string SenderEmail)? GetValid()
    {
        if (_token == null || _senderEmail == null) return null;
        if ((DateTime.UtcNow - _storedAt).TotalMinutes > 55) return null;
        return (_token, _senderEmail);
    }
}