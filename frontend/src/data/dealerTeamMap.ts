// src/data/dealerTeamMap.ts
// AUTO-GENERATED from Excel dealer list — DO NOT EDIT MANUALLY
// Source: BGauss dealer team mapping spreadsheet, merged with Breakup.xlsx (Sept 2026 BTL plan)
// Updated: added 44 dealers found in Breakup.xlsx with no match in the original 195-dealer
// list, and added dealerEmail/rsmEmail/commandoEmail wherever Breakup.xlsx had them.
//
// Usage:
//   import { findDealerTeam } from "../data/dealerTeamMap";
//   const team = findDealerTeam(dealerCode, dealerName);
//   if (team) { rsmName = team.rsm; tsmName = team.tsm; commando = team.commando; }

export interface DealerTeam {
  dealerName: string;
  city: string;
  state: string;
  rsm: string;
  tsm: string;
  commando: string;
  dealerEmail?: string;
  rsmEmail?: string;
  commandoEmail?: string;
}

// Normalize for fuzzy matching: lowercase, remove special chars and common suffixes
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(pvt|ltd|llp|private|limited|motors|automobiles|auto|mobility|ev|world|enterprise|enterprises|traders|trading)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Split a normalized name into its individual word tokens.
function tokens(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

export const DEALER_TEAM_MAP: DealerTeam[] = [
  { dealerName: "Xcel Automobiles", city: "Raigad", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "Pradip Gaikwad", dealerEmail: "bgauss.panvel@gmail.com", rsmEmail: "shashank.c@bgauss.com", commandoEmail: "pradip.gaikwad@bgauss.com" },
  { dealerName: "Shrey Mobility LLP", city: "Hyderabad", state: "Telangana", rsm: "Ramarao Karanam", tsm: "", commando: "Aashiq", dealerEmail: "bgauss.secunderabad@gmail.com", rsmEmail: "ramarao.karanam@bgauss.com" },
  { dealerName: "Ram Auto", city: "Karad", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "Anuj Roy", dealerEmail: "bgauss.karad@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com", commandoEmail: "anuj.roy@bgauss.com" },
  { dealerName: "MAHANTH AUTOMOTIVES", city: "Dharwad", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "Sumant" },
  { dealerName: "BHAYJI AUTOMOBILES", city: "Bharuch", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Soyeb", dealerEmail: "bgauss.bharuch@gmail.com", commandoEmail: "soyeb.saiyed@bgauss.com" },
  { dealerName: "Hithika Motors", city: "Vijayawada", state: "Andhra Pradesh", rsm: "Ramarao Karanam", tsm: "", commando: "K Pavan", dealerEmail: "bgauss.vijayawada@gmail.com", rsmEmail: "ramarao.karanam@bgauss.com", commandoEmail: "pavan.kumar@bgauss.com" },
  { dealerName: "SHREEJI EV WORLD", city: "Vadodara", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Soyeb", dealerEmail: "bgauss.waghodiaroad@gmail.com", commandoEmail: "soyeb.saiyed@bgauss.com" },
  { dealerName: "E-Trends Automotive", city: "Anand", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Bhavesh Luni", dealerEmail: "bgauss.anand@gmail.com", commandoEmail: "bhavesh.luni@bgauss.com" },
  { dealerName: "SRI RAM ELECTRO MOTORS", city: "Salem", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Balamanikandan B", commando: "Satheesh", dealerEmail: "bgauss.salem@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "STAR EV MOTORS", city: "Namakkal", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Balamanikandan B", commando: "Satheesh", dealerEmail: "bgauss.namakkal@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "B&K TRADEMART LLP", city: "Sambalpur", state: "Odisha", rsm: "Shrivatsa Joshi", tsm: "", commando: "Santanu", dealerEmail: "Bgauss.sambalpur@gmail.com", commandoEmail: "santanu.parida@bgauss.com" },
  { dealerName: "CHARGIFY AUTO PRIVATE LIMITED", city: "Bilaspur", state: "Chhattisgarh", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "Santosh Kumar", dealerEmail: "bgauss.vyaparvihar@gmail.com", commandoEmail: "Santosh.r@bgauss.com" },
  { dealerName: "RAJLAXMI MOTORS", city: "Jalgaon", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "", commando: "Muzammil", dealerEmail: "bgauss.jalgaon1@gmail.com", rsmEmail: "shashank.c@bgauss.com", commandoEmail: "muzammil.shah@bgauss.com" },
  { dealerName: "GREEN RIDEZ MOBILITY PRIVATE LIMITED", city: "Electronic City", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "Likhit S V", dealerEmail: "bgauss.electroniccity@gmail.com", rsmEmail: "karthigai.r@bgauss.com", commandoEmail: "likith.sv@bgauss.com" },
  { dealerName: "DEV MOTERS", city: "Saharanpur", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "Kuldeep", dealerEmail: "bgauss.saharanpur@gmail.com", rsmEmail: "victor.sirohi@bgauss.com", commandoEmail: "kuldeep.singh@bgauss.com" },
  { dealerName: "EKDANTA ETEK ENTERPRISES", city: "Haldwani", state: "Uttarakhand", rsm: "Deepak Makkar", tsm: "", commando: "Manish", dealerEmail: "bgauss.haldwani@gmail.com", commandoEmail: "manish.singh@bgauss.com" },
  { dealerName: "KUMARAN MOTOR", city: "Arcot", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Vignesh P", commando: "Surender", dealerEmail: "bgauss.arcot@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "B M MOTORS", city: "Belagavi", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "Sumant" },
  { dealerName: "RAJ ROYAL AUTOMOBILE PRIVATE LIMITED", city: "Udaipur", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Sundeep Ganchha", dealerEmail: "bgauss.udaipur@gmail.com", commandoEmail: "sundeep.ganchha@bgauss.com" },
  { dealerName: "GOLDEN MOTERS", city: "Jaipur", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Deepanshu", dealerEmail: "bgauss.jaipur1@gmail.com", commandoEmail: "dipanshu.nagar@bgauss.com" },
  { dealerName: "SRI VIJAYDURGA ELECTRICAL VEHICLES", city: "Jaggampeta", state: "Andhra Pradesh", rsm: "Ramarao Karanam", tsm: "", commando: "K Pavan", dealerEmail: "bgauss.jaggampeta@gmail.com", rsmEmail: "ramarao.karanam@bgauss.com", commandoEmail: "pavan.kumar@bgauss.com" },
  { dealerName: "KHUSHI MOTORS", city: "Dausa", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Deepanshu", dealerEmail: "Bgauss.dausa@gmail.com", commandoEmail: "dipanshu.nagar@bgauss.com" },
  { dealerName: "VOLTHUB", city: "Ratlam", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "Tej Singh", dealerEmail: "bgauss.ratlam@gmail.com", commandoEmail: "tejsingh.chouhan@bgauss.com" },
  { dealerName: "SHIRDI ECO WHEELS PRIVATE LIMITED", city: "Ajmer", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Dhanraj", dealerEmail: "bgauss.ajmer1@gmail.com", commandoEmail: "dhanraj.pal@bgauss.com" },
  { dealerName: "BACHHAN MOTORS PRIVATE LIMITED", city: "Sikar", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Dhanraj", dealerEmail: "bgauss.sikar1@gmail.com", commandoEmail: "dhanraj.pal@bgauss.com" },
  { dealerName: "RAAJHANS MOTORS", city: "Narsinghpur", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Maniram", dealerEmail: "bgauss.narsinghpur@gmail.com", commandoEmail: "maniram.bhardwaj@bgauss.com" },
  { dealerName: "ASHISH MOTORS", city: "Deoria", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "Sheo Mangal Pathak", dealerEmail: "bgauss.deoria@gmail.com", rsmEmail: "saurabh.jauhari@bgauss.com", commandoEmail: "sheo.pathak@bgauss.com" },
  { dealerName: "CHAUDHARY ELECTRIC VEHICLES", city: "Hathras", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "Kuldeep", dealerEmail: "bgauss.hathras@gmail.com", rsmEmail: "victor.sirohi@bgauss.com", commandoEmail: "kuldeep.singh@bgauss.com" },
  { dealerName: "JAYPEE EV", city: "Dwarka", state: "Delhi", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Anuj Jha" },
  { dealerName: "RAJGURU ASSOCIATES", city: "Jodhpur", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Ritik", dealerEmail: "bgaussjodhpur2@gmail.com", commandoEmail: "ritik.gupta@bgauss.com" },
  { dealerName: "CHARGIFY AUTO PRIVATE LIMITED-CHAMPA", city: "Champa", state: "Chhattisgarh", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "Santosh Kumar", dealerEmail: "bgauss.janjgir@gmail.com", commandoEmail: "Santosh.r@bgauss.com" },
  { dealerName: "ECO SARTHI MOTORS", city: "Indore", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "Umesh", dealerEmail: "bgauss.indore@gmail.com", commandoEmail: "umeshkumar.patil@bgauss.com" },
  { dealerName: "NIDHI CREATIONS", city: "Rudrapur", state: "Uttarakhand", rsm: "Deepak Makkar", tsm: "", commando: "Awdhesh" },
  { dealerName: "Devbhoomi Enterprises", city: "Haridwar", state: "Uttarakhand", rsm: "Deepak Makkar", tsm: "", commando: "Kuldeep", dealerEmail: "bgauss.haridwar@gmail.com", commandoEmail: "kuldeep.singh@bgauss.com" },
  { dealerName: "JEEVAS COMMUNICATIONS", city: "Coimbatore", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Balamanikandan B", commando: "Prasanna C", commandoEmail: "prasanna.c@bgauss.com" },
  { dealerName: "BANSAL MOTORS", city: "Meerut", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "Sachin Mishra", dealerEmail: "bgauss.meerut@gmail.com", rsmEmail: "victor.sirohi@bgauss.com", commandoEmail: "sachin.mishra@bgauss.com" },
  { dealerName: "DATTAWADE ENGINEERING ENTERPRISES LLP", city: "Kolhapur", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "Anuj Roy", dealerEmail: "bgauss.kolhapur2@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com", commandoEmail: "anuj.roy@bgauss.com" },
  { dealerName: "LPK MOTORS", city: "Tiruppur", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Balamanikandan B", commando: "Prasanna C" },
  { dealerName: "AARAV AGRO", city: "Jabalpur", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Maniram", dealerEmail: "bgauss.jabalpur@gmail.com", commandoEmail: "maniram.bhardwaj@bgauss.com" },
  { dealerName: "C A MOTORS", city: "Bhilwara", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Sundeep Ganchha", dealerEmail: "Bgauss.bhilwara02@gmail.com" },
  { dealerName: "GARG AGENCY", city: "Agra", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "Sachin Mishra", dealerEmail: "Bgauss.agra1@gmail.com", rsmEmail: "victor.sirohi@bgauss.com", commandoEmail: "sachin.mishra@bgauss.com" },
  { dealerName: "AMAN TRADING COMPANY", city: "Delhi", state: "Delhi", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Kamal" },
  { dealerName: "DIMPAL E-BIKES", city: "Jhunjhunu", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Santosh Singh", dealerEmail: "bgauss.jhunjhunu@gmail.com", commandoEmail: "santosh.singh@bgauss.com" },
  { dealerName: "MAGNEMITE MOTO LLP-PUNE", city: "Pune", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "Bhaskar", dealerEmail: "bgauss.tilakroad2@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com", commandoEmail: "bhaskar.rao@bgauss.com" },
  { dealerName: "KARNI AUTOMOBILES", city: "Nagaur", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Jitendra", dealerEmail: "bgauss.nagaur@gmail.com", commandoEmail: "jitendra.gargiya@bgauss.com" },
  { dealerName: "RAJ SHREE MOTORS", city: "Didwana", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Rohit", dealerEmail: "bgauss.didwana@gmail.com", commandoEmail: "ramkishan.chhipa@bgauss.com" },
  { dealerName: "DIVINE DESTINY", city: "Nalloor", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "Anand", dealerEmail: "Bgauss.marthandam@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com", commandoEmail: "anand.ga@bgauss.com" },
  { dealerName: "PATEL E VEHICLE", city: "Modasa", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Parth", dealerEmail: "bgauss.modasa@gmail.com", commandoEmail: "parth.joshi@bgauss.com" },
  { dealerName: "A K ENTERPRISES", city: "Moradabad", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "Manish", dealerEmail: "bgauss.moradabad@gmail.com", rsmEmail: "victor.sirohi@bgauss.com", commandoEmail: "manish.singh@bgauss.com" },
  { dealerName: "SETH BROTHERS", city: "Guna", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "Aditya", dealerEmail: "bgauss.guna@gmail.com", commandoEmail: "aditya.tomar@bgauss.com" },
  { dealerName: "EVANA MOBILITY", city: "Faridabad", state: "Haryana", rsm: "Victor Sirohi", tsm: "", commando: "Kamal" },
  { dealerName: "H.B. ENTERPRISES", city: "Biaora", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "Deetendra", dealerEmail: "bgauss.biaora@gmail.com", commandoEmail: "deetandra.mahale@bgauss.com" },
  { dealerName: "PATEL E MOTORS", city: "Gairatganj", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Prince Vishwakarma", dealerEmail: "bgauss.gairatganj@gmail.com", commandoEmail: "prince.vishwakarma@bgauss.com" },
  { dealerName: "K B REDDY AUTOMOBILES KOVVUR", city: "Kovvur", state: "Andhra Pradesh", rsm: "Ramarao Karanam", tsm: "", commando: "K Pavan", dealerEmail: "bgauss.rajahmundry@gmail.com", rsmEmail: "ramarao.karanam@bgauss.com", commandoEmail: "pavan.kumar@bgauss.com" },
  { dealerName: "NEEV AUTO", city: "Surat", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Bhavesh Luni", dealerEmail: "bgauss.udhna@gmail.com", commandoEmail: "bhavesh.luni@bgauss.com" },
  { dealerName: "BHAVANI MOTORS JAGTIAL", city: "Jagityal", state: "Telangana", rsm: "Ramarao Karanam", tsm: "", commando: "Aashiq", dealerEmail: "bgauss.jagitial@gmail.com", rsmEmail: "ramarao.karanam@bgauss.com" },
  { dealerName: "BATRA DISTRIBUTORS PRIVATE LIMITED", city: "Nagpur", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Sanket Ajabrao Jachak", commando: "Harish Kanoje", dealerEmail: "bgauss.wardhamannagar@gmail.com", rsmEmail: "shashank.c@bgauss.com", commandoEmail: "harish.kanoje@bgauss.com" },
  { dealerName: "SETH BROTHERS-ASHOKNAGAR", city: "Ashoknagar", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "Aditya", dealerEmail: "bgauss.ashoknagarguna@gmail.com", commandoEmail: "aditya.tomar@bgauss.com" },
  { dealerName: "Das Motors", city: "Bijnor", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "Awdhesh", dealerEmail: "bgauss.bijnor@gmail.com", rsmEmail: "victor.sirohi@bgauss.com", commandoEmail: "awdhesh.singh@bgauss.com" },
  { dealerName: "VEERA MOTORS", city: "Vaijapur", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "Akshay", dealerEmail: "bgauss.vaijapur@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com", commandoEmail: "akshay.lahamge@bgauss.com" },
  { dealerName: "ALLIED AUTO", city: "Korba", state: "Chhattisgarh", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "Vishwas Sharma", dealerEmail: "bgauss.korba@gmail.com", commandoEmail: "vishwas.sharma@bgauss.com" },
  { dealerName: "VIP E BIKE", city: "Mehsana", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Parth", dealerEmail: "bgauss.mehsana01@gmail.com", commandoEmail: "parth.joshi@bgauss.com" },
  { dealerName: "MARUDHAR SALES", city: "Jodhpur", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Jitendra", dealerEmail: "bgaussjodhpurev@gmail.com", commandoEmail: "jitendra.gargiya@bgauss.com" },
  { dealerName: "NICE MOTORS", city: "Vidisha", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Pranav", dealerEmail: "bgauss.vidisha@gmail.com" },
  { dealerName: "SHREE ACHYUTAM ENTERPRISES", city: "Sehore", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "Deetendra", dealerEmail: "bgauss.sehore@gmail.com", commandoEmail: "deetandra.mahale@bgauss.com" },
  { dealerName: "YUG EV WORLD", city: "Himmatnagar", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Parth", dealerEmail: "bgauss.himatnagar@gmail.com", commandoEmail: "parth.joshi@bgauss.com" },
  { dealerName: "AMRIT MOTORS", city: "Bikaner", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Jogender", dealerEmail: "bgauss.bikaner3@gmail.com" },
  { dealerName: "SANSAAR EV", city: "Agra", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "Sachin Mishra" },
  { dealerName: "ATC GREEN ENERGY", city: "Aurangabad", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "Akshay", dealerEmail: "bgauss.csnaurangabad1@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com", commandoEmail: "akshay.lahamge@bgauss.com" },
  { dealerName: "KRISHNA AND COMPANY", city: "Chittorgarh", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Sundeep Ganchha", dealerEmail: "bgauss.Chittorgarh2@gmail.com" },
  { dealerName: "K.S AUTOMOBILES", city: "Bikaner", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Jogender", dealerEmail: "Bgauss.bikaner2@gmail.com" },
  { dealerName: "Shree Shyam EV Motors", city: "Gurugram", state: "Haryana", rsm: "Victor Sirohi", tsm: "", commando: "Kamal", dealerEmail: "Bgauss.gurgaon@gmail.com", commandoEmail: "anuj.jha@bgauss.com" },
  { dealerName: "PATEL E MOBILITY", city: "Rajkot", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Ruchit", dealerEmail: "bgauss.rajkot2025@gmail.com", commandoEmail: "ruchit.zatakiya@bgauss.com" },
  { dealerName: "PATIDAR AUTOMOBILE", city: "Dhar", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "Tej Singh", dealerEmail: "Bgauss.dhar@gmail.com", commandoEmail: "tejsingh.chouhan@bgauss.com" },
  { dealerName: "KAMYA MOTORS", city: "Virudhunagar", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "Anand", dealerEmail: "bgauss.aruppukottai@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com", commandoEmail: "anand.ga@bgauss.com" },
  { dealerName: "MAA AMBEY MOTORS", city: "Maharajganj", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "Sheo Mangal Pathak" },
  { dealerName: "JK AUTO CARE", city: "Morbi", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Ruchit", dealerEmail: "bgauss.morbi1122@gmail.com", commandoEmail: "ruchit.zatakiya@bgauss.com" },
  { dealerName: "BAJRANGBALI E AUTO CENTER", city: "Saraipali", state: "Chhattisgarh", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "Vishwas Sharma", dealerEmail: "bgauss.saraipali@gmail.com", commandoEmail: "vishwas.sharma@bgauss.com" },
  { dealerName: "SHRI SAI AUTO MOBILE", city: "Raigarh", state: "Chhattisgarh", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "Santosh Kumar", dealerEmail: "bgauss.raigarh@gmail.com", commandoEmail: "Santosh.r@bgauss.com" },
  { dealerName: "GREEN MOTORS", city: "Krishnagiri", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Vignesh P", commando: "Surender" },
  { dealerName: "SHRI GURU MOTORS", city: "Kushinagar", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "Sheo Mangal Pathak", dealerEmail: "bgauss.kushinagar@gmail.com", rsmEmail: "saurabh.jauhari@bgauss.com", commandoEmail: "sheo.pathak@bgauss.com" },
  { dealerName: "APARNNA AUTO MOBILE", city: "Balangir", state: "Odisha", rsm: "Shrivatsa Joshi", tsm: "", commando: "Santanu", dealerEmail: "bgauss.balangir@gmail.com" },
  { dealerName: "DPM AUTOMOBILES", city: "Hazaribag", state: "Jharkhand", rsm: "Shrivatsa Joshi", tsm: "", commando: "Himanshu", dealerEmail: "bgauss.hazaribagh01@gmail.com", commandoEmail: "Himanshu.kumar@bgauss.com" },
  { dealerName: "NICE MOTORS - BHOPAL", city: "Bhopal", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Pranav", dealerEmail: "bgauss.bhopal1@gmail.com" },
  { dealerName: "MILESTONE MOTORS", city: "Dodballapur", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "Madhu Sudhan", dealerEmail: "bgauss.doddaballapura1@gmail.com", rsmEmail: "karthigai.r@bgauss.com", commandoEmail: "madhu.sudhana@bgauss.com" },
  { dealerName: "RADHA RAMAN ENTERPRISES", city: "Sagar", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Prince Vishwakarma", dealerEmail: "bgauss.sagar1@gmail.com", commandoEmail: "prince.vishwakarma@bgauss.com" },
  { dealerName: "RBS EV WORLD", city: "Rajkot", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Parag", dealerEmail: "bgauss.rajkot26@gmail.com", commandoEmail: "parag.jogadiya@bgauss.com" },
  { dealerName: "ANJANI MOTORS", city: "Sujangarh", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Rohit", dealerEmail: "bgauss.sujangarh@gmail.com" },
  { dealerName: "VAIDEHI MOTORS", city: "Katni", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Sandeep Chaurasiya", dealerEmail: "bgauss.katni@gmail.com", commandoEmail: "sandeep.chaurasia@bgauss.com" },
  { dealerName: "SHREE KRISHNA TRADERS", city: "Dhanbad", state: "Jharkhand", rsm: "Shrivatsa Joshi", tsm: "", commando: "Himanshu", dealerEmail: "bgauss.dhanbad@gmail.com", commandoEmail: "Himanshu.kumar@bgauss.com" },
  { dealerName: "YAA ENTERPRISES", city: "Delhi", state: "Delhi", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Anuj Jha", dealerEmail: "bgauss.najafgarh2@gmail.com", commandoEmail: "anuj.jha@bgauss.com" },
  { dealerName: "SHOURYA ENTERPRISES", city: "Raipur", state: "Chhattisgarh", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "Vishwas Sharma", dealerEmail: "bgauss.raipur04@gmail.com" },
  { dealerName: "URBAN RIDERS", city: "Bareilly", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "Awdhesh", dealerEmail: "Bgauss.urbanriders@gmail.com,bgauss.bareilly02@gmail.com", rsmEmail: "victor.sirohi@bgauss.com", commandoEmail: "awdhesh.singh@bgauss.com" },
  { dealerName: "OMASHVANI AUTOMOBILE", city: "Rewa", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Sandeep Chaurasiya", dealerEmail: "bgauss.rewa@gmail.com", commandoEmail: "sandeep.chaurasia@bgauss.com" },
  { dealerName: "SHRI SANWARIYA EV", city: "Narmadapuram", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Pranav", dealerEmail: "bgauss.narmadapuram@gmail.com", commandoEmail: "deetandra.mahale@bgauss.com" },
  { dealerName: "SHIV KRISHNA", city: "Morena", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Aditya", dealerEmail: "bgauss.morena02@gmail.com", commandoEmail: "aditya.tomar@bgauss.com" },
  { dealerName: "DIMPAL E-BIKES-CHURU", city: "Churu", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Santosh Singh", dealerEmail: "bgauss.churu02@gmail.com", commandoEmail: "santosh.singh@bgauss.com" },
  { dealerName: "BUSNUR ENTERPRISES", city: "Chitradurga", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "", dealerEmail: "bgauss.chitradurga@gmail.com", rsmEmail: "karthigai.r@bgauss.com" },
  { dealerName: "Premier E-Moto LLP", city: "Chennai", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "", dealerEmail: "bgauss.kilpauk@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "OM ENTERPRISE", city: "Bhavnagar", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", dealerEmail: "bgauss.bhavnagar@gmail.com" },
  { dealerName: "AGASTYA EV WORLD", city: "Udupi", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "" },
  { dealerName: "TRIBUS GREEN", city: "Solapur", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "", dealerEmail: "bgauss.solapur@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com" },
  { dealerName: "SSR ELECTRIC SCOOTER", city: "Chennai", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "" },
  { dealerName: "CMH MOTORS-TIRUR", city: "Malappuram", state: "Kerala", rsm: "Mohammed KP", tsm: "", commando: "", dealerEmail: "bgauss.tirur@gmail.com", rsmEmail: "mohammed.kp@bgauss.com" },
  { dealerName: "RK'S GREEN AUTO", city: "Nashik", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "", dealerEmail: "Bgauss.dwarkacircle@gmail.com", rsmEmail: "shashank.c@bgauss.com" },
  { dealerName: "ECOLECTRIC MOBILITY TECH", city: "Mumbai", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "", dealerEmail: "bgauss.parel@gmail.com", rsmEmail: "shashank.c@bgauss.com" },
  { dealerName: "KOTHARI EV BIKES", city: "Chennai", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "", dealerEmail: "bgauss.porur@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "MAHAMANTRAA MOTORS", city: "Viluppuram", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "", dealerEmail: "bgauss.tindivanam@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "AKJ MOTORS", city: "Tiruchirappalli", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "", dealerEmail: "bgauss.tiruchirappalli@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "RAJKUMAR MOTOCORP", city: "Kanchipuram", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "", dealerEmail: "bgauss.chengalpattu@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "Tectrac Private Limited", city: "Bangalore", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "", dealerEmail: "bgauss.kalyannagar@gmail.com", rsmEmail: "karthigai.r@bgauss.com" },
  { dealerName: "AGADI MOTORS PRIVATE LIMITED", city: "Davanagere", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "" },
  { dealerName: "JAI UDHAYAA EV BIKES", city: "Kallakurichi", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "BALAMANIKANDAN B", commando: "", dealerEmail: "bgauss.chinnasalem@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "E TURN MOTORS LLP", city: "Chennai", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "", dealerEmail: "bgauss.medavakkam@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "JPMR MOTORS PRIVATE LIMITED", city: "Puducherry", state: "Puducherry", rsm: "Balakrishnan K", tsm: "Vignesh P", commando: "", dealerEmail: "bgauss.puducherry@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "NJ BIKES INDIA PRIVATE LIMITED", city: "Coimbatore", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "", commando: "" },
  { dealerName: "SAHU EV SHOP", city: "Varanasi", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { dealerName: "SAROJINI MOTORS", city: "Puri", state: "Odisha", rsm: "Shrivatsa Joshi", tsm: "", commando: "", dealerEmail: "Bgauss.Puri@gmail.com" },
  { dealerName: "NJ BIKES INDIA PRIVATE LIMITED-ERODE", city: "Erode", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "BALAMANIKANDAN B", commando: "", dealerEmail: "bgauss.erode@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "SHRI SIDDHIVINAYAK E MOBILITY (OPC) PRIVATE LIMITED", city: "Sangli", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "", dealerEmail: "bgauss.sangli1@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com" },
  { dealerName: "SRI SAI ECO", city: "Nellore", state: "Andhra Pradesh", rsm: "Ramarao Karanam", tsm: "", commando: "", dealerEmail: "bgauss.nellore@gmail.com", rsmEmail: "ramarao.karanam@bgauss.com" },
  { dealerName: "NANBAN MOTORS AND AGENCY LLP", city: "Karur", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "", dealerEmail: "bgauss.karur@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "OK AUTOMOTIVES", city: "Mysuru", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "" },
  { dealerName: "SUSTAINABLE MOBILITY SOLUTIONS", city: "Thiruvananthapuram", state: "Kerala", rsm: "Mohammed KP", tsm: "", commando: "", dealerEmail: "bgauss.neeramankara@gmail.com", rsmEmail: "mohammed.kp@bgauss.com" },
  { dealerName: "MHALASAI MOTORS (OPC) PRIVATE LIMITED", city: "Dhule", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "", dealerEmail: "bgauss.dhule@gmail.com", rsmEmail: "shashank.c@bgauss.com", commandoEmail: "muzammil.shah@bgauss.com" },
  { dealerName: "DSK MOTORS", city: "Dharmapuri", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "BALAMANIKANDAN B", commando: "", dealerEmail: "bgauss.dharmapuri@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "MILESTONE ELECTRIC SCOOTERS", city: "Nelamangala", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "", dealerEmail: "bgauss.nelamangala@gmail.com", rsmEmail: "karthigai.r@bgauss.com" },
  { dealerName: "ANURON ENTERPRISES PRIVATE LIMITED", city: "Ahmednagar", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "" },
  { dealerName: "PARVATI E MOTORS", city: "Baramati", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "", dealerEmail: "bgauss.baramati@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com" },
  { dealerName: "J P AUTOMOBILES LLP", city: "Morena", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "" },
  { dealerName: "M & T MOTORS", city: "Cuddalore", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Vignesh P", commando: "", dealerEmail: "Bgauss.cuddalore@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "ANURON ENTERPRISES PRIVATE LIMITED-PUNE", city: "Pune", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "", dealerEmail: "bgauss.kothrud@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com" },
  { dealerName: "GOOD LUCK AUTOMOTIVE", city: "Tonk", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "", dealerEmail: "bgauss.tonk@gmail.com" },
  { dealerName: "PRITAM VENTURES", city: "Hosur", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Vignesh P", commando: "", dealerEmail: "bgauss.hosur01@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "ANURON ENTERPRISES PRIVATE LIMITED-NASHIK", city: "Nashik", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "" },
  { dealerName: "ANURON ENTERPRISES PRIVATE LIMITED-THANE", city: "Thane", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "" },
  { dealerName: "ANANDSHEEL PARIVAHAN PRIVATE LIMITED", city: "Lucknow", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { dealerName: "HEMAKUMAR AUTOMOTIVE-TUMAKURU", city: "Tumakuru", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "", dealerEmail: "bgauss.tumakuru21@gmail.com", rsmEmail: "karthigai.r@bgauss.com" },
  { dealerName: "ANDES MOBILITY", city: "Thiruvananthapuram", state: "Kerala", rsm: "Mohammed KP", tsm: "", commando: "", dealerEmail: "bgauss.kazhakoottam@gmail.com", rsmEmail: "mohammed.kp@bgauss.com" },
  { dealerName: "SAIRAJ ENTERPRISES", city: "Pune", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "", dealerEmail: "bgauss.wagholi@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com" },
  { dealerName: "K. M. AUTO SALES & SERVICE", city: "Lucknow", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "", dealerEmail: "bgauss.dubagga@gmail.com", rsmEmail: "saurabh.jauhari@bgauss.com", commandoEmail: "aman.kumar@bgauss.com" },
  { dealerName: "SARADA MOTORS", city: "Tenkasi", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "", dealerEmail: "bgauss.tenkasi@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "ANURON ENTERPRISES PRIVATE LIMITED-PCMC", city: "Pune", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "", commando: "" },
  { dealerName: "M/S KRISHNAMANI E V MOTORS", city: "Etawah", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "", dealerEmail: "bgauss.etawah206001@gmail.com", rsmEmail: "saurabh.jauhari@bgauss.com", commandoEmail: "aman.kumar@bgauss.com" },
  { dealerName: "DHARMACHAKRA AUTOLINK", city: "Navsari", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "" },
  { dealerName: "VIJAYVARGIYA MOTORS", city: "Shivpuri", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "", dealerEmail: "bgauss.shivpuri@gmail.com" },
  { dealerName: "METRO MOTORS", city: "Beed", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "", dealerEmail: "bgauss.beed@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com" },
  { dealerName: "KULKARNI AUTOMOBILES", city: "Amravati", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Sanket Ajabrao Jachak", commando: "", dealerEmail: "bgauss.amravati@gmail.com", rsmEmail: "shashank.c@bgauss.com" },
  { dealerName: "SHIV SHAKTI EV MOTORS-NERUL", city: "Nerul", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "", dealerEmail: "bgauss.nerul1@gmail.com", rsmEmail: "shashank.c@bgauss.com", commandoEmail: "pradip.gaikwad@bgauss.com" },
  { dealerName: "A V MOTORS", city: "Madurai", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "", dealerEmail: "bgauss.maduraiav@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "DAKSH AUTO", city: "Latur", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "", commando: "" },
  { dealerName: "VSK e Automotive", city: "Thane", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "", dealerEmail: "Bgauss.airoli@gmail.com", rsmEmail: "shashank.c@bgauss.com" },
  { dealerName: "BHALERAO MOTORS", city: "Parbhani", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "", dealerEmail: "bgauss.parbhani@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com" },
  { dealerName: "PANAMA MOTORS", city: "Kozhikode", state: "Kerala", rsm: "Mohammed KP", tsm: "", commando: "", dealerEmail: "bgauss.kozhikode@gmail.com", rsmEmail: "mohammed.kp@bgauss.com" },
  { dealerName: "H.P.B. AUTOMOBILE & SERVICE CENTRE", city: "Ramanagara", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "" },
  { dealerName: "VARMA TRACTORS", city: "Bhandara", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Sanket Ajabrao Jachak", commando: "" },
  { dealerName: "VARMA TRACTORS-GONDIA", city: "Gondia", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Sanket Ajabrao Jachak", commando: "" },
  { dealerName: "ANITA MOTORS", city: "Akola", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Sanket Ajabrao Jachak", commando: "" },
  { dealerName: "J E POWER MOTORS", city: "Dindigul", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "", dealerEmail: "bgauss.dindigul1@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "RN AUTO", city: "Unnao", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { dealerName: "BASTA ECO PRODUCTS KANNUR LLP", city: "Kannur", state: "Kerala", rsm: "Mohammed KP", tsm: "", commando: "", dealerEmail: "bgauss.kannur@gmail.com", rsmEmail: "mohammed.kp@bgauss.com" },
  { dealerName: "Om E-Motor's", city: "Deesa", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", dealerEmail: "bgauss.deesa@gmail.com", rsmEmail: "ravikant.mahawar@bgauss.com" },
  { dealerName: "NAVKAR E-BIKE", city: "Bhuj", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", dealerEmail: "bgauss.bhuj@gmail.com" },
  { dealerName: "RADHE ENTERPRISE", city: "Ahmedabad", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", dealerEmail: "bgauss.akhbarnagar@gmail.com" },
  { dealerName: "REONEXUS GREENTECH PRIVATE LIMITED", city: "Bangalore", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "" },
  { dealerName: "GUNNU ENTERPRISES", city: "Jharsuguda", state: "Odisha", rsm: "Shrivatsa Joshi", tsm: "", commando: "" },
  { dealerName: "JAIN ENTERPRISES", city: "Robertsganj", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { dealerName: "ISHANVI ELECTRIC SCOOTERS", city: "Sira", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "", dealerEmail: "bgauss.sira@gmail.com", rsmEmail: "karthigai.r@bgauss.com" },
  { dealerName: "ZOOMX AUTOHUB", city: "Chavakad", state: "Kerala", rsm: "Mohammed KP", tsm: "", commando: "", dealerEmail: "bgauss.chavakad@gmail.com", rsmEmail: "mohammed.kp@bgauss.com" },
  { dealerName: "V2 E BIKES", city: "Hanur", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "", commando: "" },
  { dealerName: "RAJ DEVI AUTOMOBILES", city: "Ayodhya", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "", dealerEmail: "ayodhyacnf@gmail.com", rsmEmail: "saurabh.jauhari@bgauss.com", commandoEmail: "aman.kumar@bgauss.com" },
  { dealerName: "GAJANAND E VEHICLES", city: "Patan", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", dealerEmail: "bgauss.patan@gmail.com" },
  { dealerName: "PREMCHAND ENERGY", city: "Baleswar", state: "Odisha", rsm: "Shrivatsa Joshi", tsm: "", commando: "", dealerEmail: "bgauss.balasore@gmail.com" },
  { dealerName: "SHASHWAT MOTORS", city: "Palanpur", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", dealerEmail: "bgauss.palanpur@gmail.com" },
  { dealerName: "BM ENTERPRISES-TIRUPATHUR", city: "Tirupathur", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Vignesh P", commando: "", dealerEmail: "bgauss.thirupattur1@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "HARIPRIYA AUTORIDERS", city: "Ambikapur", state: "Chhattisgarh", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "", dealerEmail: "Bgauss.ambikapur@gmail.com" },
  { dealerName: "M/S SHIV SHAKTI", city: "Jashpur", state: "Chhattisgarh", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "", dealerEmail: "bgauss.jashpurnagar@gmail.com" },
  { dealerName: "HARI EV MOTORS", city: "Kumbakonam", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "", dealerEmail: "Bgauss.Kumbakonam1@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "DK MOTORS", city: "Srikakulam", state: "Andhra Pradesh", rsm: "Ramarao Karanam", tsm: "", commando: "", dealerEmail: "bgauss.srikakulam1@gmail.com", rsmEmail: "ramarao.karanam@bgauss.com" },
  { dealerName: "R.K. AUTOMOBILES", city: "Kanpur Nagar", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { dealerName: "OMM SHREE ENTERPRISE", city: "Baripada", state: "Odisha", rsm: "Shrivatsa Joshi", tsm: "", commando: "", dealerEmail: "bgauss.baripada@gmail.com" },
  { dealerName: "RP VENTURES", city: "Barabanki", state: "Uttar Pradesh", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { dealerName: "CHIDHAMBARAYSWARAA AUTOMOBILES", city: "Ananthapur", state: "Andhra Pradesh", rsm: "Ramarao Karanam", tsm: "", commando: "", dealerEmail: "Bgauss.anantapur1@gmail.com", rsmEmail: "ramarao.karanam@bgauss.com" },
  { dealerName: "RATNAGIRI E - MOBILITY", city: "Ratnagiri", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "", dealerEmail: "bgauss.ratnagiri@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com" },
  { dealerName: "RCS MOTORS", city: "Tiruvannamalai", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Vignesh P", commando: "", dealerEmail: "bgauss.tiruvannamalai@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "POWER AUTOMOTIVE", city: "Jalna", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "", dealerEmail: "bgauss.jalna1@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com" },
  { dealerName: "TECHNOSAVVY AUTOMATION", city: "Ahmedabad", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", dealerEmail: "bgauss.ellisbridge@gmail.com" },
  { dealerName: "MEMO EXPRESS", city: "Kendrapara", state: "Odisha", rsm: "Shrivatsa Joshi", tsm: "", commando: "", dealerEmail: "bgauss.kendrapara@gmail.com" },
  { dealerName: "ANVIK MOTORS", city: "Kanakapura", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "", dealerEmail: "bgauss.kanakapura@gmail.com", rsmEmail: "karthigai.r@bgauss.com" },
  { dealerName: "SRI SHASTHA AUTOMOTIVE", city: "Tirupati", state: "Andhra Pradesh", rsm: "Ramarao Karanam", tsm: "", commando: "", dealerEmail: "bgauss.tirupathi@gmail.com", rsmEmail: "ramarao.karanam@bgauss.com" },
  { dealerName: "MANASVAM VENTURES LLP", city: "Pune", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "", dealerEmail: "bgauss.balewadi@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com" },
  { dealerName: "ASHIRWAD MOTORS", city: "Amravati", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Sanket Ajabrao Jachak", commando: "", dealerEmail: "bgauss.badneraroad@gmail.com", rsmEmail: "shashank.c@bgauss.com" },
  { dealerName: "TARA MULTIVENTURES LLP", city: "Dewas", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "", dealerEmail: "bgauss.dewas@gmail.com" },
  { dealerName: "RAFZO MOTORS", city: "Kadapa", state: "Andhra Pradesh", rsm: "Ramarao Karanam", tsm: "", commando: "", dealerEmail: "bgauss.kadapa@gmail.com", rsmEmail: "ramarao.karanam@bgauss.com" },
  { dealerName: "ROUSHAN MAN POWER SOLUTION", city: "Purnia", state: "Bihar", rsm: "Shrivatsa Joshi", tsm: "", commando: "", dealerEmail: "bgauss.purnea@gmail.com" },

  // ── NEW: dealers found in Breakup.xlsx (Sept 2026) with no match in the
  // original list above. City is UNKNOWN — Breakup.xlsx has no City column —
  // fill it in from ERP/dealer master before relying on it for anything city-specific.
  { dealerName: "A.J.MOTORS", city: "", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", dealerEmail: "bgauss.vapi02@gmail.com" },
  { dealerName: "AMRITA MOBILITY", city: "", state: "West Bengal", rsm: "Shrivatsa Joshi", tsm: "", commando: "", dealerEmail: "bgauss.purulia@gmail.com" },
  { dealerName: "ANAM ENTERPRISES", city: "", state: "Bihar", rsm: "Shrivatsa Joshi", tsm: "", commando: "", dealerEmail: "bgauss.muzaffarpur@gmail.com" },
  { dealerName: "ARAM MOBILITY", city: "", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "", dealerEmail: "bgauss.pallavaram@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "ARIANE MOTORS AND SERVICES", city: "", state: "Kerala", rsm: "Mohammed KP", tsm: "", commando: "", dealerEmail: "bgauss.thrissur@gmail.com", rsmEmail: "mohammed.kp@bgauss.com" },
  { dealerName: "ASHTAVINAYAK AGRO AGENCIES", city: "", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "", dealerEmail: "bgauss.yavatmal1@gmail.com", rsmEmail: "shashank.c@bgauss.com" },
  { dealerName: "BRIGHT AUTO AGENCIES", city: "", state: "Kerala", rsm: "Mohammed KP", tsm: "", commando: "", dealerEmail: "bgauss.palakkad@gmail.com", rsmEmail: "mohammed.kp@bgauss.com" },
  { dealerName: "Bike House Delhi Electric", city: "", state: "Delhi", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", rsmEmail: "victor.sirohi@bgauss.com" },
  { dealerName: "CMH MOTORSTIRUR", city: "", state: "Kerala", rsm: "Mohammed KP", tsm: "", commando: "" },
  { dealerName: "Chaudhary Automobiles", city: "", state: "Delhi", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", dealerEmail: "bgauss.shahdara@gmail.com" },
  { dealerName: "D2 GALAXYWEALTH ENTERPRISES PRIVATE LIMITED", city: "", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "", dealerEmail: "bgauss.nanded5@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com" },
  { dealerName: "DAKSH EV BIIKE", city: "", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Ram Kishan", dealerEmail: "bgauss.alwar03@gmail.com", commandoEmail: "ramkishan.chhipa@bgauss.com" },
  { dealerName: "DIPAK BIKES", city: "", state: "Maharashtra", rsm: "Aniket Chintamani", tsm: "", commando: "", dealerEmail: "bgauss.barshi01@gmail.com", rsmEmail: "aniket.chintamani@bgauss.com" },
  { dealerName: "E Wheels Automobiles", city: "", state: "Chhattisgarh", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "", rsmEmail: "victor.sirohi@bgauss.com" },
  { dealerName: "GRADUS MOTORS", city: "", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "", dealerEmail: "bgauss.indore02@gmail.com" },
  { dealerName: "GREEN MOTOR'S", city: "", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "", commando: "", dealerEmail: "bgauss.krishnagiri@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "JANA EVs", city: "", state: "West Bengal", rsm: "Shrivatsa Joshi", tsm: "", commando: "", dealerEmail: "bgauss.belda@gmail.com" },
  { dealerName: "JAY VINAYAK SERVICES", city: "", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Sundeep Ganchha", dealerEmail: "bgauss.udaipur02@gmail.com", commandoEmail: "sundeep.ganchha@bgauss.com" },
  { dealerName: "Jiya Automobiles", city: "", state: "Delhi", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", rsmEmail: "victor.sirohi@bgauss.com" },
  { dealerName: "KALPATARU ELECTRIC SCOOTERS", city: "", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "", dealerEmail: "bgauss.tiptur@gmail.com", rsmEmail: "karthigai.r@bgauss.com" },
  { dealerName: "KANIKA MOBILITY SOLUTIONS", city: "", state: "Chhattisgarh", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "", dealerEmail: "bgauss.balodabazar@gmail.com" },
  { dealerName: "KARTHIKEYA MOTORS", city: "", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "", dealerEmail: "bgauss.kolar02@gmail.com", rsmEmail: "karthigai.r@bgauss.com" },
  { dealerName: "KUMAWAT EV ZONE", city: "", state: "Rajasthan", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "", dealerEmail: "bgauss.kota02@gmail.com" },
  { dealerName: "Keshav E mobility", city: "", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", rsmEmail: "victor.sirohi@bgauss.com" },
  { dealerName: "NASTGO VENTURES", city: "", state: "Delhi", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", dealerEmail: "bgauss.kirtinagar@gmail.com" },
  { dealerName: "NEW VIJAY EV MOTORS", city: "", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "", dealerEmail: "bgauss.vijayapura@gmail.com", rsmEmail: "karthigai.r@bgauss.com" },
  { dealerName: "PRIYANSHI MOTORS", city: "", state: "Odisha", rsm: "Shrivatsa Joshi", tsm: "Asit Panda", commando: "", dealerEmail: "bgauss.bhadrak@gmail.com" },
  { dealerName: "RAGHUVANSHI EV MOTORS", city: "", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "", dealerEmail: "bgauss.betul@gmail.com" },
  { dealerName: "RAMA EEVE", city: "", state: "Jharkhand", rsm: "Shrivatsa Joshi", tsm: "", commando: "", dealerEmail: "bgauss.jamshedpur@gmail.com" },
  { dealerName: "RATHI ECO WHEELS", city: "", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "", dealerEmail: "bgauss.khamgaon@gmail.com", rsmEmail: "shashank.c@bgauss.com" },
  { dealerName: "Ryder Motors", city: "", state: "Delhi", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", rsmEmail: "victor.sirohi@bgauss.com" },
  { dealerName: "S N MOTORS", city: "", state: "Karnataka", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "", dealerEmail: "bgauss.mandya2@gmail.com", rsmEmail: "karthigai.r@bgauss.com" },
  { dealerName: "SAMARTH AUTOS", city: "", state: "Maharashtra", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "", dealerEmail: "bgauss.kopargaon@gmail.com", rsmEmail: "shashank.c@bgauss.com" },
  { dealerName: "SHIVAM MOBILITY", city: "", state: "Gujarat", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", dealerEmail: "bgauss.gandhinagar@gmail.com" },
  { dealerName: "SHREE BALAJI MOTORS", city: "", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "", dealerEmail: "bgauss.bhopal@gmail.com" },
  { dealerName: "SHREE V AUTOMOBILES", city: "", state: "Madhya Pradesh", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "", dealerEmail: "bgauss.shahdol@gmail.com" },
  { dealerName: "SHRI GANESH TRADERS", city: "", state: "Uttarakhand", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "", dealerEmail: "bgauss.shamli@gmail.com" },
  { dealerName: "SRI SAIKRISHNA EV MOTORS PRIVATE LIMITED", city: "", state: "Andhra Pradesh", rsm: "Ramarao Karanam", tsm: "", commando: "", dealerEmail: "bgauss.kurnool01@gmail.com", rsmEmail: "ramarao.karanam@bgauss.com" },
  { dealerName: "SUZO MOBILITY", city: "", state: "Odisha", rsm: "Shrivatsa Joshi", tsm: "Asit Panda", commando: "", dealerEmail: "bgauss.cuttack@gmail.com" },
  { dealerName: "Star Automotive", city: "", state: "Delhi", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", dealerEmail: "bgauss.okhla02@gmail.com" },
  { dealerName: "TEJAS MOBILITY", city: "", state: "Odisha", rsm: "Shrivatsa Joshi", tsm: "Asit Panda", commando: "Santanu", dealerEmail: "bgauss.bargarh1@gmail.com", commandoEmail: "santanu.parida@bgauss.com" },
  { dealerName: "VEVA E-BIKES", city: "", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "", dealerEmail: "bgauss.tiruppur02@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
  { dealerName: "VoltMart", city: "", state: "Delhi", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "", rsmEmail: "victor.sirohi@bgauss.com" },
  { dealerName: "E TURN MOTORS LLP-KANCHEEPURAM", city: "", state: "Tamil Nadu", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "", dealerEmail: "bgauss.kanchipuram@gmail.com", rsmEmail: "balakrishnan.k@bgauss.com" },
];

// Build a normalized lookup map for fast matching
const _normalizedMap = new Map<string, DealerTeam>(
  DEALER_TEAM_MAP.map((d) => [normalize(d.dealerName), d])
);

/**
 * Find team mapping for a dealer.
 * Match order: exact (case-insensitive) -> normalized exact -> token-subset fuzzy.
 *
 * FIX: the previous version fell back to `key.includes(normInput) ||
 * normInput.includes(key)` — a raw character-substring test. That silently
 * mismatched dealers whose normalized names happened to share a short substring
 * (e.g. "Aram Mobility" matched "Ram Auto" because "ram" sits inside "aram";
 * "Anam Enterprises" matched "Panama Motors" because "anam" sits inside "panama"),
 * silently assigning the WRONG RSM/TSM/Commando to a proposal. This version instead
 * requires the SMALLER name's word tokens (not characters) to be a full subset of
 * the larger name's tokens, with at least 2 shared tokens — single shared words
 * (common surnames, "motors", etc.) are no longer enough to auto-match.
 * @param dealerCode - ERP dealer code (not used in lookup but kept for API compat)
 * @param dealerName - Dealer name from ERP or form
 */
export function findDealerTeam(dealerCode: string, dealerName: string): DealerTeam | null {
  if (!dealerName) return null;

  // 1. Exact match (case-insensitive)
  const lowerName = dealerName.toLowerCase().trim();
  for (const d of DEALER_TEAM_MAP) {
    if (d.dealerName.toLowerCase().trim() === lowerName) return d;
  }

  // 2. Normalized exact match
  const normInput = normalize(dealerName);
  const exactNorm = _normalizedMap.get(normInput);
  if (exactNorm) return exactNorm;

  // 3. Token-subset fuzzy match — word-level, not character-level, and requires
  //    at least 2 shared tokens so a single common word can't cause a false match.
  const inputTokens = new Set(tokens(dealerName));
  for (const [key, d] of _normalizedMap) {
    const keyTokens = new Set(tokens(d.dealerName));
    const [small, big] = inputTokens.size <= keyTokens.size ? [inputTokens, keyTokens] : [keyTokens, inputTokens];
    if (small.size < 2) continue;
    let allIn = true;
    for (const t of small) { if (!big.has(t)) { allIn = false; break; } }
    if (allIn) return d;
  }

  return null;
}
