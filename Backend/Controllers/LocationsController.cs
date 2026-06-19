using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/locations")]
//[Authorize]
public class LocationsController : ControllerBase
{
    private readonly AppDbContext _db;
    public LocationsController(AppDbContext db) => _db = db;

    [HttpGet("states")]
    public async Task<ActionResult<IEnumerable<StateDto>>> GetStates()
    {
        var states = await _db.States.AsNoTracking()
            .OrderBy(s => s.Name)
            .Select(s => new StateDto(s.Id, s.Name))
            .ToListAsync();

        return Ok(states);
    }

    [HttpGet("states/{stateId:int}/cities")]
    public async Task<ActionResult<IEnumerable<CityDto>>> GetCities(int stateId)
    {
        var cities = await _db.Cities.AsNoTracking()
            .Where(c => c.StateId == stateId)
            .OrderBy(c => c.Name)
            .Select(c => new CityDto(c.Id, c.Name, c.StateId))
            .ToListAsync();

        return Ok(cities);
    }
}