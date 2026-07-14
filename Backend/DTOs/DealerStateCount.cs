namespace BGL_BT_App.Backend.DTOs;

public record DealerStateCount(
    string State,
    int    EligibleOld,
    int    EligibleNew,
    int    NonEligible,
    int    Total
);