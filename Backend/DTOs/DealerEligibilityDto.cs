namespace BGL_BT_App.Backend.DTOs;
public record DealerEligibilityDto(
    string DealerCode,
    bool   IsEligible,
    bool   IsNewDealer,
    double AvgMonthlyRetails,
    string EligibilityReason,
    int    BaseCacPerVehicle,
    string DealerType
);