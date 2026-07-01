using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using BGL_BT_App.Backend.Models;

namespace BGL_BT_App.Backend.Services;

public class JwtTokenService
{
    private readonly IConfiguration _config;
    public JwtTokenService(IConfiguration config) => _config = config;

    public string GenerateToken(User user)
    {
        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(_config["DealerJwt:Secret"]
                ?? throw new InvalidOperationException("DealerJwt:Secret not configured")));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new("sub", user.Id.ToString()),
            new("email", user.Email),
            new("name", user.DisplayName),
            new("role", user.Role),
            new("authType", "Local"),
        };
        if (!string.IsNullOrEmpty(user.DealerCode))
            claims.Add(new Claim("dealerCode", user.DealerCode));

        var token = new JwtSecurityToken(
            issuer:             _config["DealerJwt:Issuer"]   ?? "bgauss-btl",
            audience:           _config["DealerJwt:Audience"] ?? "bgauss-btl-dealers",
            claims:             claims,
            expires:            DateTime.UtcNow.AddHours(12),
            signingCredentials: creds
        );
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}