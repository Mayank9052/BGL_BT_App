using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BGL_BT_App.Backend.Services;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class UsersController : ControllerBase
{
    private readonly IUserService _userService;

    public UsersController(IUserService userService) => _userService = userService;

    // GET /api/users  (admin sees all users)
    [HttpGet]
    public async Task<IActionResult> GetAll()
        => Ok(await _userService.GetAllUsersAsync());
}