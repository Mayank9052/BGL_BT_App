namespace BGL_BT_App.Backend.DTOs;

public record ResetPasswordDto(string Email, string Token, string NewPassword);