// Backend/Services/GraphAppTokenService.cs
using System.Net.Http.Json;
using System.Text.Json;

namespace BGL_BT_App.Backend.Services;

/// <summary>
/// Acquires an app-only (client-credentials) Microsoft Graph access token —
/// used for email flows where there is NO signed-in user (e.g. dealer
/// forgot-password on the public login page). This is fundamentally
/// different from the delegated/interactive Graph tokens the rest of the
/// app uses (via the X-Graph-Token header), which only exist when the
/// caller is already signed into Microsoft.
///
/// Requires: the Azure AD app registration must have the Mail.Send
/// APPLICATION permission granted with admin consent. Without that, every
/// call here will succeed in getting a token but fail with 403 when
/// actually sending mail.
/// </summary>
public class GraphAppTokenService
{
    private readonly IConfiguration _config;
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<GraphAppTokenService> _logger;

    private string? _cachedToken;
    private DateTime _expiresAtUtc = DateTime.MinValue;

    public GraphAppTokenService(
        IConfiguration config, IHttpClientFactory httpFactory, ILogger<GraphAppTokenService> logger)
    {
        _config = config; _httpFactory = httpFactory; _logger = logger;
    }

    public async Task<string> GetAppOnlyTokenAsync()
    {
        // Reuse the cached token until 2 minutes before it actually expires.
        if (_cachedToken is not null && DateTime.UtcNow < _expiresAtUtc.AddMinutes(-2))
            return _cachedToken;

        var tenantId     = _config["AzureAd:TenantId"];
        var clientId     = _config["AzureAd:ClientId"];
        var clientSecret = _config["AzureAd:ClientSecret"];

        if (string.IsNullOrWhiteSpace(tenantId) || string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret))
            throw new InvalidOperationException("AzureAd:TenantId/ClientId/ClientSecret must be configured for app-only Graph auth.");

        var http = _httpFactory.CreateClient();
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"]     = clientId,
            ["client_secret"] = clientSecret,
            ["scope"]         = "https://graph.microsoft.com/.default",
            ["grant_type"]    = "client_credentials",
        });

        var res = await http.PostAsync(
            $"https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token", form);
        var raw = await res.Content.ReadAsStringAsync();

        if (!res.IsSuccessStatusCode)
        {
            _logger.LogError("Failed to acquire app-only Graph token: {Status} {Body}", res.StatusCode, raw);
            throw new InvalidOperationException($"App-only Graph token request failed: {res.StatusCode}");
        }

        using var doc = JsonDocument.Parse(raw);
        var root = doc.RootElement;
        _cachedToken  = root.GetProperty("access_token").GetString();
        var expiresIn = root.GetProperty("expires_in").GetInt32();
        _expiresAtUtc = DateTime.UtcNow.AddSeconds(expiresIn);

        return _cachedToken!;
    }
}