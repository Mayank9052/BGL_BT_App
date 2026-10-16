// Backend/Services/CnAttachmentLoader.cs
//
// Collects the supporting documents for the Accounts CN email:
//   01 BGauss-name final invoice → 02 vendor invoice(s) → 03 activity photos.
// Videos are never attached (size) — they go as portal links.
// Reads from local disk first (wwwroot/...), else downloads over HTTP from
// Cn:PublicMediaBaseUrl (default Smtp:PortalBaseUrl).
// Limits: Cn:MaxFileMb (default 20) per file, Cn:MaxTotalMb (default 25) total;
// anything over the limit is sent as a link instead of an attachment.

using BGL_BT_App.Backend.Helpers;
using BGL_BT_App.Backend.Models;
using Microsoft.AspNetCore.Hosting;

namespace BGL_BT_App.Backend.Services;

public class CnAttachmentLoader
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _cfg;
    private readonly ILogger<CnAttachmentLoader> _log;

    public CnAttachmentLoader(IHttpClientFactory httpFactory, IWebHostEnvironment env,
                              IConfiguration cfg, ILogger<CnAttachmentLoader> log)
    {
        _httpFactory = httpFactory; _env = env; _cfg = cfg; _log = log;
    }

    private long MaxFileBytes  => (long)((_cfg.GetValue<double?>("Cn:MaxFileMb")  ?? 20) * 1024 * 1024);
    private long MaxTotalBytes => (long)((_cfg.GetValue<double?>("Cn:MaxTotalMb") ?? 25) * 1024 * 1024);

    private static bool IsAbsolute(string url) =>
        url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
        url.StartsWith("https://", StringComparison.OrdinalIgnoreCase);

    public string PublicUrl(string url)
    {
        if (IsAbsolute(url)) return url;
        var baseUrl = new[] { _cfg["Cn:PublicMediaBaseUrl"], _cfg["Smtp:PortalBaseUrl"], "https://btl.bgauss.com" }
            .First(x => !string.IsNullOrWhiteSpace(x))!.TrimEnd('/');
        return baseUrl + (url.StartsWith('/') ? url : "/" + url);
    }

    public async Task<(List<CnMailAttachment> Files, List<CnMailLink> Links, List<string> Notes)>
        CollectAsync(ProposalActivity a)
    {
        var files = new List<CnMailAttachment>();
        var links = new List<CnMailLink>();
        var notes = new List<string>();

        var items = new List<(string Prefix, string Url, string? Name, string? Type)>();
        if (!string.IsNullOrWhiteSpace(a.CnFinalInvoiceUrl))
            items.Add(("01_BGauss_Invoice", a.CnFinalInvoiceUrl!, a.CnFinalInvoiceFileName, null));

        var media = (a.MediaFiles ?? new List<ActivityMedia>()).ToList();
        foreach (var m in media.Where(m => CnReportBuilder.IsInvoiceDoc(m.FileType)))
            items.Add(("02_Vendor_Invoice", m.FileUrl, m.FileName, m.FileType));
        foreach (var m in media.Where(m => CnReportBuilder.IsPhoto(m.FileType)))
            items.Add(("03_Photo", m.FileUrl, m.FileName, m.FileType));
        if (!string.IsNullOrWhiteSpace(a.MediaFileUrl) && media.All(m => m.FileUrl != a.MediaFileUrl))
            items.Add((CnReportBuilder.IsPhoto(a.MediaFileType) ? "03_Photo" : "02_Vendor_Invoice",
                       a.MediaFileUrl!, a.MediaFileName, a.MediaFileType));
        foreach (var m in media.Where(m => CnReportBuilder.IsVideo(m.FileType)))
            links.Add(new CnMailLink($"Video — {m.FileName}", PublicUrl(m.FileUrl)));

        long total = 0;
        int seq = 0;
        foreach (var it in items)
        {
            if (string.IsNullOrWhiteSpace(it.Url)) continue;
            var label = $"{it.Prefix.Replace('_', ' ')[3..]} — {it.Name ?? "file"}";
            var (file, reason) = await LoadAsync(it.Url, it.Name, it.Type);
            if (file is null)
            {
                links.Add(new CnMailLink(label, PublicUrl(it.Url)));
                notes.Add($"{it.Name ?? it.Url}: {reason} — sent as link.");
                continue;
            }
            if (total + file.Content.LongLength > MaxTotalBytes)
            {
                links.Add(new CnMailLink(label, PublicUrl(it.Url)));
                notes.Add($"{file.FileName}: total attachment size limit reached — sent as link.");
                continue;
            }
            seq++;
            files.Add(file with { FileName = $"{it.Prefix}_{seq:00}_{Sanitize(file.FileName)}" });
            total += file.Content.LongLength;
        }
        return (files, links, notes);
    }

    private async Task<(CnMailAttachment? File, string? Reason)> LoadAsync(string url, string? fileName, string? contentType)
    {
        byte[]? bytes = null;
        var ct = contentType;

        try
        {
            if (!IsAbsolute(url))
            {
                var local = ResolveLocal(url);
                if (local != null) bytes = await File.ReadAllBytesAsync(local);
            }
            if (bytes == null)
            {
                var http = _httpFactory.CreateClient("cn-media");
                using var resp = await http.GetAsync(PublicUrl(url));
                if (!resp.IsSuccessStatusCode)
                    return (null, $"download failed (HTTP {(int)resp.StatusCode})");
                bytes = await resp.Content.ReadAsByteArrayAsync();
                ct ??= resp.Content.Headers.ContentType?.MediaType;
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "CN attachment load failed for {Url}", url);
            return (null, "could not be read");
        }

        if (bytes.Length > MaxFileBytes)
            return (null, $"file is {bytes.Length / 1024 / 1024} MB (limit {MaxFileBytes / 1024 / 1024} MB)");

        var name = !string.IsNullOrWhiteSpace(fileName)
            ? fileName!
            : Path.GetFileName(url.Split('?')[0]);
        if (string.IsNullOrWhiteSpace(name)) name = "file";
        ct = string.IsNullOrWhiteSpace(ct) || ct == "application/octet-stream" ? GuessType(name) : ct;

        return (new CnMailAttachment(name, ct!, bytes, PublicUrl(url)), null);
    }

    // Local file under wwwroot / content root — path-traversal safe.
    private string? ResolveLocal(string relative)
    {
        var clean = Uri.UnescapeDataString(relative.Split('?')[0]).TrimStart('/', '\\')
                       .Replace('/', Path.DirectorySeparatorChar);
        var roots = new[]
        {
            _env.WebRootPath,
            Path.Combine(_env.ContentRootPath, "wwwroot"),
            _env.ContentRootPath,
            _cfg["Cn:LocalMediaRoot"],
        }.Where(r => !string.IsNullOrWhiteSpace(r)).Distinct();

        foreach (var root in roots)
        {
            var rootFull = Path.GetFullPath(root!);
            var full = Path.GetFullPath(Path.Combine(rootFull, clean));
            if (full.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase) && File.Exists(full))
                return full;
        }
        return null;
    }

    private static string Sanitize(string name)
    {
        var s = string.Concat(name.Split(Path.GetInvalidFileNameChars())).Trim();
        return s.Length > 100 ? s[^100..] : (s.Length == 0 ? "file" : s);
    }

    private static string GuessType(string name) => Path.GetExtension(name).ToLowerInvariant() switch
    {
        ".pdf"  => "application/pdf",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png"  => "image/png",
        ".webp" => "image/webp",
        ".heic" => "image/heic",
        ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls"  => "application/vnd.ms-excel",
        ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc"  => "application/msword",
        _       => "application/octet-stream",
    };
}
