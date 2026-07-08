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
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

// ── Database ──────────────────────────────────────────────────────────────────
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddDbContext<BaplDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("BaplConnection")));

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
        // SignalR WebSocket: no Authorization header — check query string
        var accessToken = ctx.Request.Query["access_token"];
        if (!string.IsNullOrEmpty(accessToken) &&
            ctx.Request.Path.StartsWithSegments("/hubs/chat"))
            return "AzureAD";

        var authHeader = ctx.Request.Headers["Authorization"].FirstOrDefault();
        if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer "))
            return "AzureAD";

        var token = authHeader["Bearer ".Length..];
        try
        {
            var handler = new JwtSecurityTokenHandler();
            var jwt     = handler.ReadJwtToken(token);
            return jwt.Issuer == builder.Configuration["DealerJwt:Issuer"]
                ? "DealerJwt"
                : "AzureAD";
        }
        catch { return "AzureAD"; }
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

// ── Email ─────────────────────────────────────────────────────────────────────
builder.Services.AddHttpClient<GraphEmailService>();
builder.Services.AddScoped<IEmailService, GraphEmailService>();
builder.Services.Configure<SmtpSettings>(builder.Configuration.GetSection("Smtp"));

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

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseCors("FrontendPolicy");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<ChatHub>("/hubs/chat");
app.MapFallbackToFile("index.html");
app.Run();