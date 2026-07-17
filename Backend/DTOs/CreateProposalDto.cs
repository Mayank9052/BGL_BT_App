using System.Text.Json.Serialization;
namespace BGL_BT_App.Backend.DTOs;
public record CreateProposalDto
{
    [JsonPropertyName("state")]        public string  State        { get; init; } = "";
    [JsonPropertyName("location")]     public string  Location     { get; init; } = "";
    [JsonPropertyName("type")]         public string  Type         { get; init; } = "";
    [JsonPropertyName("dealerName")]   public string  DealerName   { get; init; } = "";
    [JsonPropertyName("dealerCode")]   public string? DealerCode   { get; init; }
    [JsonPropertyName("vendorId")]     public int?    VendorId     { get; init; }
    [JsonPropertyName("vendorName")]   public string? VendorName   { get; init; }
    [JsonPropertyName("rsmName")]      public string  RsmName      { get; init; } = "";
    [JsonPropertyName("tsmName")]      public string  TsmName      { get; init; } = "";
    [JsonPropertyName("commandoName")]  public string? CommandoName { get; init; }
    [JsonPropertyName("month")]        public string  Month        { get; init; } = "";
    [JsonPropertyName("year")]        public string? Year         { get; init; }
    [JsonPropertyName("eligibility")]  public string  Eligibility  { get; init; } = "";
    [JsonPropertyName("remarks")]      public string? Remarks      { get; init; }
    [JsonPropertyName("submittedBy")]  public string? SubmittedBy  { get; init; }
    [JsonPropertyName("docNumber")]    public string? DocNumber    { get; init; }
    [JsonPropertyName("totalBudget")]        public decimal TotalBudget       { get; init; }
    [JsonPropertyName("totalLeadTarget")]    public int     TotalLeadTarget   { get; init; }
    [JsonPropertyName("totalRetailTarget")]  public int     TotalRetailTarget { get; init; }
    [JsonPropertyName("cac")]          public decimal Cac          { get; init; }
    [JsonPropertyName("cpl")]          public decimal Cpl          { get; init; }
    [JsonPropertyName("activities")]   public List<ActivityDto> Activities { get; init; } = new();
};