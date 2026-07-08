namespace BGL_BT_App.Backend.DTOs;

public record SendWaTemplateDto(string Phone, string TemplateName, List<string>? Params, string? ContactName);