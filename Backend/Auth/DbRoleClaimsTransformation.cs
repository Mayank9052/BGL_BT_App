using System.Security.Claims;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authentication;

namespace BGL_BT_App.Backend.Auth;

public class DbRoleClaimsTransformation : IClaimsTransformation
{
    private readonly IUserService _userService;
    public DbRoleClaimsTransformation(IUserService userService) => _userService = userService;

    public async Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        if (principal.Identity is not ClaimsIdentity identity || !identity.IsAuthenticated)
            return principal;

        if (principal.HasClaim(c => c.Type == ClaimTypes.Role))
            return principal;

        var email = principal.FindFirstValue(ClaimTypes.Email)
            ?? principal.FindFirstValue("preferred_username")
            ?? principal.FindFirstValue(ClaimTypes.Upn);

        if (email is null) return principal;

        var dbUser = await _userService.GetByEmailAsync(email);
        if (dbUser is not null)
            identity.AddClaim(new Claim(ClaimTypes.Role, dbUser.Role));

        return principal;
    }
}