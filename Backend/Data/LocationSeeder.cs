// backend/Data/LocationSeeded.cs
using BGL_BT_App.Backend.Models;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Data;

public static class LocationSeeder
{
    private static readonly Dictionary<string, string[]> StatesAndCities = new()
    {
        ["Andhra Pradesh"] = new[] { "Visakhapatnam", "Vijayawada", "Guntur", "Nellore", "Tirupati", "Kakinada" },
        ["Arunachal Pradesh"] = new[] { "Itanagar", "Naharlagun", "Pasighat" },
        ["Assam"] = new[] { "Guwahati", "Dibrugarh", "Silchar", "Jorhat", "Tezpur" },
        ["Bihar"] = new[] { "Patna", "Gaya", "Bhagalpur", "Muzaffarpur", "Darbhanga" },
        ["Chhattisgarh"] = new[] { "Raipur", "Bhilai", "Bilaspur", "Korba", "Durg" },
        ["Goa"] = new[] { "Panaji", "Margao", "Vasco da Gama", "Mapusa" },
        ["Gujarat"] = new[] { "Ahmedabad", "Surat", "Vadodara", "Rajkot", "Gandhinagar", "Bhavnagar" },
        ["Haryana"] = new[] { "Gurugram", "Faridabad", "Panipat", "Ambala", "Hisar", "Karnal" },
        ["Himachal Pradesh"] = new[] { "Shimla", "Manali", "Dharamshala", "Solan", "Mandi" },
        ["Jharkhand"] = new[] { "Ranchi", "Jamshedpur", "Dhanbad", "Bokaro", "Hazaribagh" },
        ["Karnataka"] = new[] { "Bengaluru", "Mysuru", "Mangaluru", "Hubballi", "Belagavi", "Davangere" },
        ["Kerala"] = new[] { "Kochi", "Thiruvananthapuram", "Kozhikode", "Thrissur", "Kollam" },
        ["Madhya Pradesh"] = new[] { "Bhopal", "Indore", "Jabalpur", "Gwalior", "Ujjain" },
        ["Maharashtra"] = new[] { "Mumbai", "Pune", "Nagpur", "Nashik", "Kolhapur", "Aurangabad", "Thane", "Solapur" },
        ["Manipur"] = new[] { "Imphal", "Thoubal" },
        ["Meghalaya"] = new[] { "Shillong", "Tura" },
        ["Mizoram"] = new[] { "Aizawl", "Lunglei" },
        ["Nagaland"] = new[] { "Kohima", "Dimapur" },
        ["Odisha"] = new[] { "Bhubaneswar", "Cuttack", "Rourkela", "Berhampur" },
        ["Punjab"] = new[] { "Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Mohali" },
        ["Rajasthan"] = new[] { "Jaipur", "Jodhpur", "Udaipur", "Kota", "Ajmer", "Bikaner" },
        ["Sikkim"] = new[] { "Gangtok", "Namchi" },
        ["Tamil Nadu"] = new[] { "Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem" },
        ["Telangana"] = new[] { "Hyderabad", "Warangal", "Nizamabad", "Karimnagar" },
        ["Tripura"] = new[] { "Agartala", "Udaipur" },
        ["Uttar Pradesh"] = new[] { "Lucknow", "Kanpur", "Noida", "Ghaziabad", "Agra", "Varanasi", "Prayagraj" },
        ["Uttarakhand"] = new[] { "Dehradun", "Haridwar", "Haldwani", "Rishikesh" },
        ["West Bengal"] = new[] { "Kolkata", "Howrah", "Durgapur", "Siliguri", "Asansol" },
        ["Delhi"] = new[] { "New Delhi", "Dwarka", "Rohini", "Saket" },
        ["Jammu & Kashmir"] = new[] { "Jammu", "Srinagar", "Anantnag" },
        ["Ladakh"] = new[] { "Leh", "Kargil" },
        ["Puducherry"] = new[] { "Puducherry", "Karaikal" },
        ["Chandigarh"] = new[] { "Chandigarh" },
    };

    public static async Task SeedAsync(AppDbContext db)
    {
        if (await db.States.AnyAsync()) return;

        foreach (var (stateName, cityNames) in StatesAndCities)
        {
            var state = new State
            {
                Name = stateName,
                Cities = cityNames.Select(c => new City { Name = c }).ToList(),
            };
            db.States.Add(state);
        }

        await db.SaveChangesAsync();
    }
}