// Backend/DTOs/DealerSendBackDto.cs
namespace BGL_BT_App.Backend.DTOs;

public record DealerSendBackDto(
    string DealerEmail,
    string RequestNote
);