// src/data/dealerTeamMap.ts
// ── TEMPORARY stopgap data source ───────────────────────────────────────────
// RSM / TSM / Sales Commando lookup by dealer, generated from the team-mapping
// CSV ("Dealers - BG Team Mapping - July 26 (1) SCMD Jul 26 (1).csv").
// RSMForm.tsx and ApproverDashboard.tsx call
// findDealerTeam(customerCode, customerName) when a dealer is selected/edited,
// and use the result to auto-fill these 3 fields — falling back to the old
// ERP-based fields (commented out in those files) if no match is found here.
//
// Generated from 195 rows in the source CSV. To refresh, re-export the
// sheet as CSV and regenerate this file — do not hand-edit rows below unless
// necessary, since the next refresh will overwrite them.

export interface DealerTeamRow {
  customerCode?: string;   // optional — matched first if present
  customerName:  string;   // required — matched if code is missing/unmatched
  rsm:           string;
  tsm:           string;
  commando:      string;
}

const DEALER_TEAM_MAP: DealerTeamRow[] = [
  { customerCode: "CUS0001", customerName: "Xcel Automobiles", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "Pradip Gaikwad" },
  { customerCode: "CUS0002", customerName: "Shrey Mobility LLP", rsm: "Ramarao Karanam", tsm: "", commando: "Aashiq" },
  { customerCode: "CUS0021", customerName: "Ram Auto", rsm: "Aniket Chintamani", tsm: "", commando: "Anuj Roy" },
  { customerCode: "CUS0028", customerName: "MAHANTH AUTOMOTIVES", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "Sumant" },
  { customerCode: "CUS0050", customerName: "BHAYJI AUTOMOBILES", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Soyeb" },
  { customerCode: "CUS0057", customerName: "Hithika Motors", rsm: "Ramarao Karanam", tsm: "", commando: "K Pavan" },
  { customerCode: "CUS0069", customerName: "SHREEJI EV WORLD", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Soyeb" },
  { customerCode: "CUS0071", customerName: "E-Trends Automotive", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Bhavesh Luni" },
  { customerCode: "CUS0117", customerName: "SRI RAM ELECTRO MOTORS", rsm: "Balakrishnan K", tsm: "Balamanikandan B", commando: "Satheesh" },
  { customerCode: "CUS0134", customerName: "STAR EV MOTORS", rsm: "Balakrishnan K", tsm: "Balamanikandan B", commando: "Satheesh" },
  { customerCode: "CUS0147", customerName: "B&K TRADEMART LLP", rsm: "Shrivatsa Joshi", tsm: "", commando: "Santanu" },
  { customerCode: "CUS0150", customerName: "CHARGIFY AUTO PRIVATE LIMITED", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "Santosh Kumar" },
  { customerCode: "CUS0151", customerName: "RAJLAXMI MOTORS", rsm: "Shashank Chinnapurkar", tsm: "", commando: "Muzammil" },
  { customerCode: "CUS0156", customerName: "GREEN RIDEZ MOBILITY PRIVATE LIMITED", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "Likhit S V" },
  { customerCode: "CUS0158", customerName: "DEV MOTERS", rsm: "Deepak Makkar", tsm: "", commando: "Kuldeep" },
  { customerCode: "CUS0169", customerName: "EKDANTA ETEK ENTERPRISES", rsm: "Deepak Makkar", tsm: "", commando: "Manish" },
  { customerCode: "CUS0194", customerName: "KUMARAN MOTOR", rsm: "Balakrishnan K", tsm: "Vignesh P", commando: "Surender" },
  { customerCode: "CUS0198", customerName: "B M MOTORS", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "Sumant" },
  { customerCode: "CUS0211", customerName: "RAJ ROYAL AUTOMOBILE PRIVATE LIMITED", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Sundeep Ganchha" },
  { customerCode: "CUS0219", customerName: "GOLDEN MOTERS", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Deepanshu" },
  { customerCode: "CUS0222", customerName: "SRI VIJAYDURGA ELECTRICAL VEHICLES", rsm: "Ramarao Karanam", tsm: "", commando: "K Pavan" },
  { customerCode: "CUS0232", customerName: "KHUSHI MOTORS", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Deepanshu" },
  { customerCode: "CUS0251", customerName: "VOLTHUB", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "Tej Singh" },
  { customerCode: "CUS0255", customerName: "SHIRDI ECO WHEELS PRIVATE LIMITED", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Dhanraj" },
  { customerCode: "CUS0275", customerName: "BACHHAN MOTORS PRIVATE LIMITED", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Dhanraj" },
  { customerCode: "CUS0276", customerName: "RAAJHANS MOTORS", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Maniram" },
  { customerCode: "CUS0277", customerName: "ASHISH MOTORS", rsm: "Deepak Makkar", tsm: "", commando: "Sheo Mangal Pathak" },
  { customerCode: "CUS0278", customerName: "CHAUDHARY ELECTRIC VEHICLES", rsm: "Deepak Makkar", tsm: "", commando: "Kuldeep" },
  { customerCode: "CUS0285", customerName: "JAYPEE EV", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Anuj Jha" },
  { customerCode: "CUS0290", customerName: "RAJGURU ASSOCIATES", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Ritik" },
  { customerCode: "CUS0296", customerName: "CHARGIFY AUTO PRIVATE LIMITED-CHAMPA", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "Santosh Kumar" },
  { customerCode: "CUS0299", customerName: "ECO SARTHI MOTORS", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "Umesh" },
  { customerCode: "CUS0300", customerName: "NIDHI CREATIONS", rsm: "Deepak Makkar", tsm: "", commando: "Awdhesh" },
  { customerCode: "CUS0304", customerName: "Devbhoomi Enterprises", rsm: "Deepak Makkar", tsm: "", commando: "Kuldeep" },
  { customerCode: "CUS0308", customerName: "JEEVAS COMMUNICATIONS", rsm: "Balakrishnan K", tsm: "Balamanikandan B", commando: "Prasanna C" },
  { customerCode: "CUS0311", customerName: "BANSAL MOTORS", rsm: "Deepak Makkar", tsm: "", commando: "Sachin Mishra" },
  { customerCode: "CUS0322", customerName: "DATTAWADE ENGINEERING ENTERPRISES LLP", rsm: "Aniket Chintamani", tsm: "", commando: "Anuj Roy" },
  { customerCode: "CUS0329", customerName: "LPK MOTORS", rsm: "Balakrishnan K", tsm: "Balamanikandan B", commando: "Prasanna C" },
  { customerCode: "CUS0338", customerName: "AARAV AGRO", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Maniram" },
  { customerCode: "CUS0339", customerName: "C A MOTORS", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Sundeep Ganchha" },
  { customerCode: "CUS0343", customerName: "GARG AGENCY", rsm: "Deepak Makkar", tsm: "", commando: "Sachin Mishra" },
  { customerCode: "CUS0345", customerName: "AMAN TRADING COMPANY", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Kamal" },
  { customerCode: "CUS0346", customerName: "DIMPAL E-BIKES", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Santosh Singh" },
  { customerCode: "CUS0347", customerName: "MAGNEMITE MOTO LLP-PUNE", rsm: "Aniket Chintamani", tsm: "", commando: "Bhaskar" },
  { customerCode: "CUS0348", customerName: "KARNI AUTOMOBILES", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Jitendra" },
  { customerCode: "CUS0350", customerName: "RAJ SHREE MOTORS", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Rohit" },
  { customerCode: "CUS0351", customerName: "DIVINE DESTINY", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "Anand" },
  { customerCode: "CUS0357", customerName: "PATEL E VEHICLE", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Parth" },
  { customerCode: "CUS0364", customerName: "A K ENTERPRISES", rsm: "Deepak Makkar", tsm: "", commando: "Manish" },
  { customerCode: "CUS0365", customerName: "SETH BROTHERS", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "Aditya" },
  { customerCode: "CUS0366", customerName: "EVANA MOBILITY", rsm: "Victor Sirohi", tsm: "", commando: "Kamal" },
  { customerCode: "CUS0367", customerName: "H.B. ENTERPRISES", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "Deetendra" },
  { customerCode: "CUS0372", customerName: "PATEL E MOTORS", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Prince Vishwakarma" },
  { customerCode: "CUS0374", customerName: "K B REDDY AUTOMOBILES KOVVUR", rsm: "Ramarao Karanam", tsm: "", commando: "K Pavan" },
  { customerCode: "CUS0379", customerName: "NEEV AUTO", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Bhavesh Luni" },
  { customerCode: "CUS0381", customerName: "BHAVANI MOTORS JAGTIAL", rsm: "Ramarao Karanam", tsm: "", commando: "Aashiq" },
  { customerCode: "CUS0382", customerName: "BATRA DISTRIBUTORS PRIVATE LIMITED", rsm: "Shashank Chinnapurkar", tsm: "Sanket Ajabrao Jachak", commando: "Harish Kanoje" },
  { customerCode: "CUS0390", customerName: "SETH BROTHERS-ASHOKNAGAR", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "Aditya" },
  { customerCode: "CUS0391", customerName: "Das Motors", rsm: "Deepak Makkar", tsm: "", commando: "Awdhesh" },
  { customerCode: "CUS0392", customerName: "VEERA MOTORS", rsm: "Aniket Chintamani", tsm: "", commando: "Akshay" },
  { customerCode: "CUS0403", customerName: "ALLIED AUTO", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "Vishwas Sharma" },
  { customerCode: "CUS0407", customerName: "VIP E BIKE", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Parth" },
  { customerCode: "CUS0415", customerName: "MARUDHAR SALES", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Jitendra" },
  { customerCode: "CUS0416", customerName: "NICE MOTORS", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Pranav" },
  { customerCode: "CUS0423", customerName: "SHREE ACHYUTAM ENTERPRISES", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "Deetendra" },
  { customerCode: "CUS0424", customerName: "YUG EV WORLD", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Parth" },
  { customerCode: "CUS0429", customerName: "AMRIT MOTORS", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Jogender" },
  { customerCode: "CUS0431", customerName: "SANSAAR EV", rsm: "Deepak Makkar", tsm: "", commando: "Sachin Mishra" },
  { customerCode: "CUS0432", customerName: "ATC GREEN ENERGY", rsm: "Aniket Chintamani", tsm: "", commando: "Akshay" },
  { customerCode: "CUS0436", customerName: "KRISHNA AND COMPANY", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Sundeep Ganchha" },
  { customerCode: "CUS0439", customerName: "K.S AUTOMOBILES", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Jogender" },
  { customerCode: "CUS0440", customerName: "Shree Shyam EV Motors", rsm: "Victor Sirohi", tsm: "", commando: "Kamal" },
  { customerCode: "CUS0447", customerName: "PATEL E MOBILITY", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Ruchit" },
  { customerCode: "CUS0449", customerName: "PATIDAR AUTOMOBILE", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "Tej Singh" },
  { customerCode: "CUS0453", customerName: "KAMYA MOTORS", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "Anand" },
  { customerCode: "CUS0454", customerName: "MAA AMBEY MOTORS", rsm: "Deepak Makkar", tsm: "", commando: "Sheo Mangal Pathak" },
  { customerCode: "CUS0455", customerName: "JK AUTO CARE", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Ruchit" },
  { customerCode: "CUS0458", customerName: "BAJRANGBALI E AUTO CENTER", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "Vishwas Sharma" },
  { customerCode: "CUS0459", customerName: "SHRI SAI AUTO MOBILE", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "Santosh Kumar" },
  { customerCode: "CUS0463", customerName: "GREEN MOTORS", rsm: "Balakrishnan K", tsm: "Vignesh P", commando: "Surender" },
  { customerCode: "CUS0468", customerName: "SHRI GURU MOTORS", rsm: "Deepak Makkar", tsm: "", commando: "Sheo Mangal Pathak" },
  { customerCode: "CUS0471", customerName: "APARNNA AUTO MOBILE", rsm: "Shrivatsa Joshi", tsm: "", commando: "Santanu" },
  { customerCode: "CUS0472", customerName: "DPM AUTOMOBILES", rsm: "Shrivatsa Joshi", tsm: "", commando: "Himanshu" },
  { customerCode: "CUS0473", customerName: "NICE MOTORS - BHOPAL", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Pranav" },
  { customerCode: "CUS0475", customerName: "MILESTONE MOTORS", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "Madhu Sudhan" },
  { customerCode: "CUS0476", customerName: "RADHA RAMAN ENTERPRISES", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Prince Vishwakarma" },
  { customerCode: "CUS0477", customerName: "RBS EV WORLD", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "Parag" },
  { customerCode: "CUS0478", customerName: "ANJANI MOTORS", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Rohit" },
  { customerCode: "CUS0481", customerName: "VAIDEHI MOTORS", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Sandeep Chaurasiya" },
  { customerCode: "CUS0482", customerName: "SHREE KRISHNA TRADERS", rsm: "Shrivatsa Joshi", tsm: "", commando: "Himanshu" },
  { customerCode: "CUS0489", customerName: "YAA ENTERPRISES", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Anuj Jha" },
  { customerCode: "CUS0495", customerName: "SHOURYA ENTERPRISES", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "Vishwas Sharma" },
  { customerCode: "CUS0496", customerName: "URBAN RIDERS", rsm: "Deepak Makkar", tsm: "", commando: "Awdhesh" },
  { customerCode: "CUS0497", customerName: "OMASHVANI AUTOMOBILE", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Sandeep Chaurasiya" },
  { customerCode: "CUS0500", customerName: "SHRI SANWARIYA EV", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Pranav" },
  { customerCode: "CUS0501", customerName: "SHIV KRISHNA", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "Aditya" },
  { customerCode: "CUS0504", customerName: "DIMPAL E-BIKES-CHURU", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "Santosh Singh" },
  { customerCode: "CUS0013", customerName: "BUSNUR ENTERPRISES", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "" },
  { customerCode: "CUS0016", customerName: "Premier E-Moto LLP", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "" },
  { customerCode: "CUS0037", customerName: "OM ENTERPRISE", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "" },
  { customerCode: "CUS0045", customerName: "AGASTYA EV WORLD", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "" },
  { customerCode: "CUS0067", customerName: "TRIBUS GREEN", rsm: "Aniket Chintamani", tsm: "", commando: "" },
  { customerCode: "CUS0073", customerName: "SSR ELECTRIC SCOOTER", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "" },
  { customerCode: "CUS0074", customerName: "CMH MOTORS-TIRUR", rsm: "Mohammed KP", tsm: "", commando: "" },
  { customerCode: "CUS0076", customerName: "RK'S GREEN AUTO", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "" },
  { customerCode: "CUS0087", customerName: "ECOLECTRIC MOBILITY TECH", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "" },
  { customerCode: "CUS0095", customerName: "KOTHARI EV BIKES", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "" },
  { customerCode: "CUS0110", customerName: "MAHAMANTRAA MOTORS", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "" },
  { customerCode: "CUS0115", customerName: "AKJ MOTORS", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "" },
  { customerCode: "CUS0116", customerName: "RAJKUMAR MOTOCORP", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "" },
  { customerCode: "CUS0120", customerName: "Tectrac Private Limited", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "" },
  { customerCode: "CUS0131", customerName: "AGADI MOTORS PRIVATE LIMITED", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "" },
  { customerCode: "CUS0144", customerName: "JAI UDHAYAA EV BIKES", rsm: "Balakrishnan K", tsm: "BALAMANIKANDAN B", commando: "" },
  { customerCode: "CUS0174", customerName: "E TURN MOTORS LLP", rsm: "Balakrishnan K", tsm: "Santhosh B", commando: "" },
  { customerCode: "CUS0175", customerName: "JPMR MOTORS PRIVATE LIMITED", rsm: "Balakrishnan K", tsm: "Vignesh P", commando: "" },
  { customerCode: "CUS0176", customerName: "NJ BIKES INDIA PRIVATE LIMITED", rsm: "Balakrishnan K", tsm: "", commando: "" },
  { customerCode: "CUS0177", customerName: "SAHU EV SHOP", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { customerCode: "CUS0178", customerName: "SAROJINI MOTORS", rsm: "Shrivatsa Joshi", tsm: "", commando: "" },
  { customerCode: "CUS0180", customerName: "NJ BIKES INDIA PRIVATE LIMITED-ERODE", rsm: "Balakrishnan K", tsm: "BALAMANIKANDAN B", commando: "" },
  { customerCode: "CUS0185", customerName: "SHRI SIDDHIVINAYAK E MOBILITY (OPC) PRIVATE LIMITED", rsm: "Aniket Chintamani", tsm: "", commando: "" },
  { customerCode: "CUS0186", customerName: "SRI SAI ECO", rsm: "Ramarao Karanam", tsm: "", commando: "" },
  { customerCode: "CUS0192", customerName: "NANBAN MOTORS AND AGENCY LLP", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "" },
  { customerCode: "CUS0195", customerName: "OK AUTOMOTIVES", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "" },
  { customerCode: "CUS0197", customerName: "SUSTAINABLE MOBILITY SOLUTIONS", rsm: "Mohammed KP", tsm: "", commando: "" },
  { customerCode: "CUS0205", customerName: "MHALASAI MOTORS (OPC) PRIVATE LIMITED", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "" },
  { customerCode: "CUS0216", customerName: "DSK MOTORS", rsm: "Balakrishnan K", tsm: "BALAMANIKANDAN B", commando: "" },
  { customerCode: "CUS0230", customerName: "MILESTONE ELECTRIC SCOOTERS", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "" },
  { customerCode: "CUS0247", customerName: "ANURON ENTERPRISES PRIVATE LIMITED", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "" },
  { customerCode: "CUS0250", customerName: "PARVATI E MOTORS", rsm: "Aniket Chintamani", tsm: "", commando: "" },
  { customerCode: "CUS0261", customerName: "J P AUTOMOBILES LLP", rsm: "Victor Sirohi", tsm: "Triloki Nath Jha", commando: "" },
  { customerCode: "CUS0262", customerName: "M & T MOTORS", rsm: "Balakrishnan K", tsm: "Vignesh P", commando: "" },
  { customerCode: "CUS0273", customerName: "ANURON ENTERPRISES PRIVATE LIMITED-PUNE", rsm: "Aniket Chintamani", tsm: "", commando: "" },
  { customerCode: "CUS0280", customerName: "GOOD LUCK AUTOMOTIVE", rsm: "Victor Sirohi", tsm: "Javed Hussain Usta", commando: "" },
  { customerCode: "CUS0289", customerName: "PRITAM VENTURES", rsm: "Balakrishnan K", tsm: "Vignesh P", commando: "" },
  { customerCode: "CUS0298", customerName: "ANURON ENTERPRISES PRIVATE LIMITED-NASHIK", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "" },
  { customerCode: "CUS0305", customerName: "ANURON ENTERPRISES PRIVATE LIMITED-THANE", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "" },
  { customerCode: "CUS0307", customerName: "ANANDSHEEL PARIVAHAN PRIVATE LIMITED", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { customerCode: "CUS0310", customerName: "HEMAKUMAR AUTOMOTIVE-TUMAKURU", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "" },
  { customerCode: "CUS0313", customerName: "ANDES MOBILITY", rsm: "Mohammed KP", tsm: "", commando: "" },
  { customerCode: "CUS0317", customerName: "SAIRAJ ENTERPRISES", rsm: "Aniket Chintamani", tsm: "", commando: "" },
  { customerCode: "CUS0320", customerName: "K. M. AUTO SALES & SERVICE", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { customerCode: "CUS0321", customerName: "SARADA MOTORS", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "" },
  { customerCode: "CUS0324", customerName: "ANURON ENTERPRISES PRIVATE LIMITED-PCMC", rsm: "Shashank Chinnapurkar", tsm: "", commando: "" },
  { customerCode: "CUS0325", customerName: "M/S KRISHNAMANI E V MOTORS", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { customerCode: "CUS0326", customerName: "DHARMACHAKRA AUTOLINK", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "" },
  { customerCode: "CUS0327", customerName: "VIJAYVARGIYA MOTORS", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "" },
  { customerCode: "CUS0331", customerName: "METRO MOTORS", rsm: "Aniket Chintamani", tsm: "", commando: "" },
  { customerCode: "CUS0334", customerName: "KULKARNI AUTOMOBILES", rsm: "Shashank Chinnapurkar", tsm: "Sanket Ajabrao Jachak", commando: "" },
  { customerCode: "CUS0337", customerName: "SHIV SHAKTI EV MOTORS-NERUL", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "" },
  { customerCode: "CUS0340", customerName: "A V MOTORS", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "" },
  { customerCode: "CUS0352", customerName: "DAKSH AUTO", rsm: "Shashank Chinnapurkar", tsm: "", commando: "" },
  { customerCode: "CUS0353", customerName: "VSK e Automotive", rsm: "Shashank Chinnapurkar", tsm: "Amol Sanap", commando: "" },
  { customerCode: "CUS0358", customerName: "BHALERAO MOTORS", rsm: "Aniket Chintamani", tsm: "", commando: "" },
  { customerCode: "CUS0361", customerName: "PANAMA MOTORS", rsm: "Mohammed KP", tsm: "", commando: "" },
  { customerCode: "CUS0362", customerName: "H.P.B. AUTOMOBILE & SERVICE CENTRE", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "" },
  { customerCode: "CUS0375", customerName: "VARMA TRACTORS", rsm: "Shashank Chinnapurkar", tsm: "Sanket Ajabrao Jachak", commando: "" },
  { customerCode: "CUS0377", customerName: "VARMA TRACTORS-GONDIA", rsm: "Shashank Chinnapurkar", tsm: "Sanket Ajabrao Jachak", commando: "" },
  { customerCode: "CUS0383", customerName: "ANITA MOTORS", rsm: "Shashank Chinnapurkar", tsm: "Sanket Ajabrao Jachak", commando: "" },
  { customerCode: "CUS0384", customerName: "J E POWER MOTORS", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "" },
  { customerCode: "CUS0385", customerName: "RN AUTO", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { customerCode: "CUS0389", customerName: "BASTA ECO PRODUCTS KANNUR LLP", rsm: "Mohammed KP", tsm: "", commando: "" },
  { customerCode: "CUS0393", customerName: "Om E-Motor's", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "" },
  { customerCode: "CUS0402", customerName: "NAVKAR E-BIKE", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "" },
  { customerCode: "CUS0404", customerName: "RADHE ENTERPRISE", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "" },
  { customerCode: "CUS0405", customerName: "REONEXUS GREENTECH PRIVATE LIMITED", rsm: "R Karthigaiselvan", tsm: "Anand Chavan", commando: "" },
  { customerCode: "CUS0406", customerName: "GUNNU ENTERPRISES", rsm: "Shrivatsa Joshi", tsm: "", commando: "" },
  { customerCode: "CUS0409", customerName: "JAIN ENTERPRISES", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { customerCode: "CUS0411", customerName: "ISHANVI ELECTRIC SCOOTERS", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "" },
  { customerCode: "CUS0412", customerName: "ZOOMX AUTOHUB", rsm: "Mohammed KP", tsm: "", commando: "" },
  { customerCode: "CUS0413", customerName: "V2 E BIKES", rsm: "R Karthigaiselvan", tsm: "", commando: "" },
  { customerCode: "CUS0414", customerName: "RAJ DEVI AUTOMOBILES", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { customerCode: "CUS0420", customerName: "GAJANAND E VEHICLES", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "" },
  { customerCode: "CUS0427", customerName: "PREMCHAND ENERGY", rsm: "Shrivatsa Joshi", tsm: "", commando: "" },
  { customerCode: "CUS0430", customerName: "SHASHWAT MOTORS", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "" },
  { customerCode: "CUS0435", customerName: "BM ENTERPRISES-TIRUPATHUR", rsm: "Balakrishnan K", tsm: "Vignesh P", commando: "" },
  { customerCode: "CUS0437", customerName: "HARIPRIYA AUTORIDERS", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "" },
  { customerCode: "CUS0442", customerName: "M/S SHIV SHAKTI", rsm: "Victor Sirohi", tsm: "Prakhar Futan", commando: "" },
  { customerCode: "CUS0445", customerName: "HARI EV MOTORS", rsm: "Balakrishnan K", tsm: "Aravindraj K", commando: "" },
  { customerCode: "CUS0448", customerName: "DK MOTORS", rsm: "Ramarao Karanam", tsm: "", commando: "" },
  { customerCode: "CUS0450", customerName: "R.K. AUTOMOBILES", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { customerCode: "CUS0451", customerName: "OMM SHREE ENTERPRISE", rsm: "Shrivatsa Joshi", tsm: "", commando: "" },
  { customerCode: "CUS0456", customerName: "RP VENTURES", rsm: "Deepak Makkar", tsm: "", commando: "" },
  { customerCode: "CUS0457", customerName: "CHIDHAMBARAYSWARAA AUTOMOBILES", rsm: "Ramarao Karanam", tsm: "", commando: "" },
  { customerCode: "CUS0461", customerName: "RATNAGIRI E - MOBILITY", rsm: "Aniket Chintamani", tsm: "", commando: "" },
  { customerCode: "CUS0465", customerName: "RCS MOTORS", rsm: "Balakrishnan K", tsm: "Vignesh P", commando: "" },
  { customerCode: "CUS0466", customerName: "POWER AUTOMOTIVE", rsm: "Aniket Chintamani", tsm: "", commando: "" },
  { customerCode: "CUS0467", customerName: "TECHNOSAVVY AUTOMATION", rsm: "Victor Sirohi", tsm: "Ravi Kant Mahawar", commando: "" },
  { customerCode: "CUS0469", customerName: "MEMO EXPRESS", rsm: "Shrivatsa Joshi", tsm: "", commando: "" },
  { customerCode: "CUS0470", customerName: "ANVIK MOTORS", rsm: "R Karthigaiselvan", tsm: "Jagadeesh Tubachi", commando: "" },
  { customerCode: "CUS0474", customerName: "SRI SHASTHA AUTOMOTIVE", rsm: "Ramarao Karanam", tsm: "", commando: "" },
  { customerCode: "CUS0480", customerName: "MANASVAM VENTURES LLP", rsm: "Aniket Chintamani", tsm: "", commando: "" },
  { customerCode: "CUS0487", customerName: "ASHIRWAD MOTORS", rsm: "Shashank Chinnapurkar", tsm: "Sanket Ajabrao Jachak", commando: "" },
  { customerCode: "CUS0488", customerName: "TARA MULTIVENTURES LLP", rsm: "Victor Sirohi", tsm: "Darpan Maheshwari", commando: "" },
  { customerCode: "CUS0490", customerName: "RAFZO MOTORS", rsm: "Ramarao Karanam", tsm: "", commando: "" },
  { customerCode: "CUS0491", customerName: "ROUSHAN MAN POWER SOLUTION", rsm: "Shrivatsa Joshi", tsm: "", commando: "" },
];

// Collapse irregular whitespace + lowercase, so "AARAV AGRO " / "Aarav  Agro"
// still match "aarav agro" — mirrors the same normalize() used in SearchableSelect.
const normalize = (s: string | null | undefined): string =>
  (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Look up a dealer's RSM / TSM / Sales Commando from the static team-mapping
 * data. Tries an exact customerCode match first (most reliable), then falls
 * back to a normalized customerName match. Returns null if no row matches —
 * callers should fall back to the ERP-based fields in that case.
 */
export function findDealerTeam(
  customerCode: string | null | undefined,
  customerName: string | null | undefined,
): DealerTeamRow | null {
  if (customerCode) {
    const byCode = DEALER_TEAM_MAP.find(
      (r) => r.customerCode && normalize(r.customerCode) === normalize(customerCode)
    );
    if (byCode) return byCode;
  }
  if (customerName) {
    const n = normalize(customerName);
    const byName = DEALER_TEAM_MAP.find((r) => normalize(r.customerName) === n);
    if (byName) return byName;
  }
  return null;
}