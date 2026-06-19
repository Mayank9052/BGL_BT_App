namespace BGL_BT_App.Backend.Models;

public class City
{
    public int Id { get; set; }
    public int StateId { get; set; }
    public State? State { get; set; }
    public string Name { get; set; } = string.Empty;
}