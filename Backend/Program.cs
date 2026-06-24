using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Identity.Web;
using BGL_BT_App.Backend.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Server.Kestrel.Core;

var builder = WebApplication.CreateBuilder(args);

// ── Database ──────────────────────────────────────────────────────────────────
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

// ── ERP read-only (baplfinal on Azure SQL) ────────────────────────────────────
builder.Services.AddDbContext<BaplDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("BaplConnection")));

// ── Azure AD Authentication ───────────────────────────────────────────────────
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"));

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
builder.Services.AddTransient<IClaimsTransformation, DbRoleClaimsTransformation>();

// ── Email — Graph API (sends as logged-in user via Mail.Send scope) ───────────
builder.Services.AddHttpClient<GraphEmailService>();
builder.Services.AddScoped<IEmailService, GraphEmailService>();

// ── DO NOT register EmailService here — it conflicts with GraphEmailService ───
// builder.Services.AddSingleton<IEmailService, EmailService>();  ← remove this

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

// ── Serve React frontend from wwwroot ─────────────────────────────────────────
app.UseDefaultFiles();
app.UseStaticFiles();

// ── API middleware ────────────────────────────────────────────────────────────
app.UseCors("FrontendPolicy");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

// ── React Router fallback ─────────────────────────────────────────────────────
app.MapFallbackToFile("index.html");

app.Run();