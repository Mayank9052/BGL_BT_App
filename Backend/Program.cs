using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Hubs;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Identity.Web;
using BGL_BT_App.Backend.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

// ── Database ──────────────────────────────────────────────────────────────────
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("DefaultConnection"),
        sqlOptions =>
        {
            sqlOptions.CommandTimeout(30);                     // seconds per query
            sqlOptions.EnableRetryOnFailure(
                maxRetryCount:     2,                           // was 5
                maxRetryDelay:     TimeSpan.FromSeconds(5),
                errorNumbersToAdd: null);
        }));

builder.Services.AddDbContext<BaplDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("BaplConnection"),
        sqlOptions => sqlOptions.EnableRetryOnFailure(
            maxRetryCount:       3,
            maxRetryDelay:       TimeSpan.FromSeconds(6),
            errorNumbersToAdd:   null)));

// ── Authentication — Azure AD (staff) + Local JWT (dealers) ───────────────────
var authBuilder = builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = "MultiScheme";
    options.DefaultChallengeScheme    = "MultiScheme";
});

// AddMicrosoftIdentityWebApi(IConfigurationSection, string) — the correct 2-arg overload
authBuilder.AddMicrosoftIdentityWebApi(
    builder.Configuration.GetSection("AzureAd"),
    "AzureAD");

// ── SignalR WebSocket auth fix ─────────────────────────────────────────────────
// WebSocket cannot send HTTP headers; SignalR appends ?access_token=... to the URL.
// PostConfigure reads it from the query string so the JWT validator sees it.
builder.Services.PostConfigure<JwtBearerOptions>("AzureAD", options =>
{
    var existing = options.Events ?? new JwtBearerEvents();
    var prevOnMessageReceived = existing.OnMessageReceived;

    existing.OnMessageReceived = async context =>
    {
        // Run any existing handler first
        if (prevOnMessageReceived != null)
            await prevOnMessageReceived(context);

        // Only inject token for the SignalR hub path
        var accessToken = context.Request.Query["access_token"];
        var path        = context.HttpContext.Request.Path;
        if (!string.IsNullOrEmpty(accessToken) &&
            path.StartsWithSegments("/hubs/chat"))
        {
            context.Token = accessToken;
        }
    };

    options.Events = existing;
});

authBuilder.AddJwtBearer("DealerJwt", options =>
{
    var jwtSecret = builder.Configuration["DealerJwt:Secret"]!;
    options.Events = new JwtBearerEvents
    {
        // SignalR sends the token as ?access_token= on WebSocket/SSE requests
        OnMessageReceived = ctx =>
        {
            var token = ctx.Request.Query["access_token"];
            if (!string.IsNullOrEmpty(token) && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                ctx.Token = token;
            return Task.CompletedTask;
        },
    };
    options.MapInboundClaims = false;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer           = true,
        ValidIssuer              = builder.Configuration["DealerJwt:Issuer"],
        ValidateAudience         = true,
        ValidAudience            = builder.Configuration["DealerJwt:Audience"],
        ValidateLifetime         = true,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey         = new SymmetricSecurityKey(
                                       Encoding.UTF8.GetBytes(jwtSecret)),
        NameClaimType = "name",
        RoleClaimType = "role",
    };
});

authBuilder.AddPolicyScheme("MultiScheme", "MultiScheme", options =>
{
    options.ForwardDefaultSelector = ctx =>
    {
        // ── Helper: detect whether a raw JWT string is a DealerJwt ────────────
        static string DetectScheme(string token, string dealerIssuer)
        {
            try
            {
                var handler = new JwtSecurityTokenHandler();
                var jwt     = handler.ReadJwtToken(token);
                return jwt.Issuer == dealerIssuer ? "DealerJwt" : "AzureAD";
            }
            catch { return "AzureAD"; }
        }

        var dealerIssuer = builder.Configuration["DealerJwt:Issuer"] ?? "";

        // ── SignalR hub path — check query string token first, then header ─────
        // WebSocket/SSE sends access_token in query string
        if (ctx.Request.Path.StartsWithSegments("/hubs/chat"))
        {
            var qs = ctx.Request.Query["access_token"].FirstOrDefault();
            if (!string.IsNullOrEmpty(qs))
                return DetectScheme(qs, dealerIssuer);   // dealer OR azure
            // Negotiate request has Authorization header
            var hdr = ctx.Request.Headers["Authorization"].FirstOrDefault();
            if (!string.IsNullOrEmpty(hdr) && hdr.StartsWith("Bearer "))
                return DetectScheme(hdr["Bearer ".Length..], dealerIssuer);
            return "AzureAD"; // fallback
        }

        // ── All other routes — parse Authorization header ─────────────────────
        var authHeader = ctx.Request.Headers["Authorization"].FirstOrDefault();
        if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer "))
            return "AzureAD";

        return DetectScheme(authHeader["Bearer ".Length..], dealerIssuer);
    };
});

builder.Services.AddAuthorization();

// ── CORS ─────────────────────────────────────────────────────────────────────
var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? new[] { "http://localhost:5173" };

builder.Services.AddCors(options =>
{
    options.AddPolicy("FrontendPolicy", policy =>
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials());   // required for SignalR WebSocket upgrade
});

// ── Upload limits ─────────────────────────────────────────────────────────────
const long OneGb = 1_073_741_824L;
builder.Services.Configure<FormOptions>(o =>
{
    o.MultipartBodyLengthLimit    = OneGb;
    o.ValueLengthLimit            = int.MaxValue;
    o.MultipartHeadersLengthLimit = int.MaxValue;
});
builder.Services.Configure<KestrelServerOptions>(o =>
    o.Limits.MaxRequestBodySize = OneGb);
builder.Services.Configure<IISServerOptions>(o =>
    o.MaxRequestBodySize = OneGb);

// ── Core services ─────────────────────────────────────────────────────────────
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddSingleton<JwtTokenService>();
builder.Services.AddTransient<IClaimsTransformation, DbRoleClaimsTransformation>();
builder.Services.AddSingleton<GraphTokenStore>();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<GraphAppTokenService>();
// Registered TWICE, deliberately: once as itself (so controllers can inject
// it directly for immediate sends), once as the hosted background service
// (the nightly safety-net loop). Both share the same stateless logic.
builder.Services.AddSingleton<DailyDigestService>();
builder.Services.AddHostedService<ErpAutoSyncService>();
// 27.10.2026 — midnight digest switched OFF: the state-wise summary mail now goes out
// immediately on "Forward Selected to Final Approver" (POST /api/proposals/forward-now).
// DailyDigestService stays registered (above) because it is still the app-only fallback sender.
// builder.Services.AddHostedService(sp => sp.GetRequiredService<DailyDigestService>());

// ── Email ─────────────────────────────────────────────────────────────────────
builder.Services.AddHttpClient<GraphEmailService>();
builder.Services.AddScoped<IEmailService, GraphEmailService>();
builder.Services.Configure<SmtpSettings>(builder.Configuration.GetSection("Smtp"));
builder.Services.AddScoped<AuditLogService>();
// ── CN (Credit Note) workflow ─────────────────────────────────────────────────
builder.Services.AddHttpClient("cn-graph", c => c.Timeout = TimeSpan.FromMinutes(5));
builder.Services.AddHttpClient("cn-media", c => c.Timeout = TimeSpan.FromMinutes(2));
builder.Services.AddScoped<CnAttachmentLoader>();
builder.Services.AddScoped<CnEmailService>();
// ── Dealer Old/New from RRERP (shared by eligibility, CAC limit, Dealer Mapping) ──
builder.Services.AddScoped<DealerTypeService>();
// ── Chat — SignalR + AI bot with DB access ────────────────────────────────────
builder.Services.AddSignalR(opts =>
{
    opts.EnableDetailedErrors      = builder.Environment.IsDevelopment();
    opts.MaximumReceiveMessageSize = 64 * 1024;
    opts.ClientTimeoutInterval     = TimeSpan.FromSeconds(60);
    opts.KeepAliveInterval         = TimeSpan.FromSeconds(20);
});
builder.Services.AddHttpClient("anthropic");
builder.Services.AddScoped<IBotService, BotService>();   // BotService now has AppDbContext

// ── WhatsApp ──────────────────────────────────────────────────────────────────
builder.Services.AddHttpClient("whatsapp");
builder.Services.AddScoped<IWhatsAppService, WhatsAppService>();

// ── Build ─────────────────────────────────────────────────────────────────────
var app = builder.Build();

app.Use(async (context, next) =>
{
    try { await next(); }
    catch (Exception ex)
    {
        var logger = context.RequestServices.GetRequiredService<ILogger<Program>>();
        logger.LogError(ex, "Unhandled exception on {Path}", context.Request.Path);
        context.Response.StatusCode  = 500;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync(
            System.Text.Json.JsonSerializer.Serialize(new
            {
                message = ex.Message,
                inner   = ex.InnerException?.Message,
            }));
    }
});

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "BGL BT API v1");
        c.RoutePrefix = string.Empty;
    });
}

// ── NEW: API responses are never cached by the browser ───────────────────────
// (proposal lists, dealer mapping etc. always fresh after a deploy or an edit)
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.OnStarting(() =>
        {
            context.Response.Headers.CacheControl = "no-store, no-cache, max-age=0";
            context.Response.Headers.Pragma       = "no-cache";
            return Task.CompletedTask;
        });
    }
    await next();
});

// ── NEW: cache rules for the React build in wwwroot ──────────────────────────
//   index.html, version.json, /template/*  → never cached (fresh after every deploy)
//   /assets/*  (Vite files, hash in file name) → cached 1 year (name changes every build)
//   /uploads/* and everything else          → unchanged (browser default)
var staticOptions = new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        var path = ctx.Context.Request.Path;
        var name = ctx.File.Name;

        if (name.Equals("index.html",   StringComparison.OrdinalIgnoreCase) ||
            name.Equals("version.json", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWithSegments("/template"))
        {
            NoCache(ctx);
        }
        else if (path.StartsWithSegments("/assets"))
        {
            ctx.Context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        }
    },
};

app.UseDefaultFiles();
app.UseStaticFiles(staticOptions);          // ← was app.UseStaticFiles();
app.UseCors("FrontendPolicy");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<ChatHub>("/hubs/chat");
// ── Health check endpoint ─────────────────────────────────────────────────────
app.MapGet("/api/health", () => "Testing...").AllowAnonymous();
// SPA fallback (deep links like /rsm-form, /cn-tracker) — index.html never cached
app.MapFallbackToFile("index.html", new StaticFileOptions { OnPrepareResponse = NoCache });   // ← was app.MapFallbackToFile("index.html");
app.Run();

// ── Helper: "never cache this file" headers ──────────────────────────────────
static void NoCache(StaticFileResponseContext ctx)
{
    var h = ctx.Context.Response.Headers;
    h.CacheControl = "no-store, no-cache, must-revalidate, max-age=0";
    h.Pragma       = "no-cache";
    h.Expires      = "0";
}
