namespace BGL_BT_App.Backend.Models;

public class State
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;

    public ICollection<City> Cities { get; set; } = new List<City>();
}