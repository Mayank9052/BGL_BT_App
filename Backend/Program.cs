using BGL_BT_App.Backend.Data;
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

// ── ERP read-only (baplfinal on Azure SQL) ────────────────────────────────────
builder.Services.AddDbContext<BaplDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("BaplConnection")));

// ── Authentication — Azure AD (staff) + Local JWT (dealers) ───────────────────
// Capture the base AuthenticationBuilder first, then add each scheme on it —
// AddMicrosoftIdentityWebApi returns a specialized builder that doesn't
// expose AddJwtBearer/AddPolicyScheme directly.
var authBuilder = builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = "MultiScheme";
    options.DefaultChallengeScheme    = "MultiScheme";
});

authBuilder.AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"), "AzureAD");

authBuilder.AddJwtBearer("DealerJwt", options =>
{
    var jwtSecret = builder.Configuration["DealerJwt:Secret"]!;

    // Prevent JwtSecurityTokenHandler from rewriting short claim names
    // ("sub", "email", "role") into long XML-namespace ClaimTypes
    // equivalents — keeps claims exactly as issued by JwtTokenService.
    options.MapInboundClaims = false;

    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer           = true,
        ValidIssuer              = builder.Configuration["DealerJwt:Issuer"],
        ValidateAudience         = true,
        ValidAudience            = builder.Configuration["DealerJwt:Audience"],
        ValidateLifetime         = true,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey         = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
        NameClaimType            = "name",
        RoleClaimType             = "role",
    };
});

authBuilder.AddPolicyScheme("MultiScheme", "MultiScheme", options =>
{
    options.ForwardDefaultSelector = ctx =>
    {
        var authHeader = ctx.Request.Headers["Authorization"].FirstOrDefault();
        if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer "))
            return "AzureAD";

        var token = authHeader["Bearer ".Length..];
        try
        {
            var handler = new JwtSecurityTokenHandler();
            var jwt = handler.ReadJwtToken(token);
            return jwt.Issuer == builder.Configuration["DealerJwt:Issuer"]
                ? "DealerJwt"
                : "AzureAD";
        }
        catch
        {
            return "AzureAD";
        }
    };
});

builder.Services.AddAuthorization();

// ── CORS ──────────────────────────────────────────────────────────────────────
var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? new[] { "http://localhost:5173" };

builder.Services.AddCors(options =>
{
    options.AddPolicy("FrontendPolicy", policy =>
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials());
});

// ── 1 GB upload limits ────────────────────────────────────────────────────────
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

// ── Services ──────────────────────────────────────────────────────────────────
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddSingleton<JwtTokenService>();
builder.Services.AddTransient<IClaimsTransformation, DbRoleClaimsTransformation>();

// ── Email — Graph API (sends as logged-in user via Mail.Send scope) ───────────
builder.Services.AddHttpClient<GraphEmailService>();
builder.Services.AddScoped<IEmailService, GraphEmailService>();

builder.Services.Configure<SmtpSettings>(builder.Configuration.GetSection("Smtp"));

var app = builder.Build();

// ── Global error handler ──────────────────────────────────────────────────────
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
            System.Text.Json.JsonSerializer.Serialize(new {
                message = ex.Message,
                inner   = ex.InnerException?.Message
            }));
    }
});

// ── Middleware Pipeline ───────────────────────────────────────
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

app.MapFallbackToFile("index.html");

app.Run();