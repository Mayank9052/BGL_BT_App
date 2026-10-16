// Backend/DTOs/NotifyDealerDto.cs
namespace BGL_BT_App.Backend.DTOs;
public record NotifyDealerDto(
    string DealerEmail,
    string? RsmEmail = null,
    string? TsmEmail = null,
    string? CommandoEmail = null
);