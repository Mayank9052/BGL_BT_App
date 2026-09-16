// Backend/Helpers/EmployeeRoleMap.cs
namespace BGL_BT_App.Backend.Helpers;

public static class EmployeeRoleMap
{
    // DesignationId → BTL portal Role string, matching H_DesignationMaster
    public static readonly Dictionary<int, string> DesignationToRole = new()
    {
        { 25, "RSM" },       // Regional Manager
        { 24, "TSM" },       // Territory Manager
        { 36, "ZSM" },       // ZSM
        { 26, "Commando" },  // Sales Commando
    };

    public static string? ToRole(int designationId) =>
        DesignationToRole.TryGetValue(designationId, out var role) ? role : null;
}