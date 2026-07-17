// src/pages/DashboardPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { useAuthStore } from "../store/authStore";
import {
  fetchMyProposals,
  fetchProposals,
  type ProposalResponse,
} from "../services/proposalService";
import { fetchDealerStateCounts, type DealerStateCount } from "../services/dealerService";
import {
  downloadExcelReport,
  downloadPdfReport,
  type ReportFilters,
} from "../services/reportService";
import "./DashboardPage.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const inr = (v: number) => "₹ " + Math.round(v).toLocaleString("en-IN");
const inrCompact = (v: number): string => {
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1)}L`;
  if (v >= 1_000)    return `₹${(v / 1_000).toFixed(0)}K`;
  return `₹${v}`;
};

// ─── Report tab type ───────────────────────────────────────────────────────────
type ReportTab = "overview" | "daily-summary" | "lead-report" | "dealer-daily";

// ─── Mock: Daily Summary data (from Image 2) ──────────────────────────────────
interface DailySummaryRow {
  sr: number; dealer: string; location: string; state: string;
  zone: string; bgMember: string; canopy: number;
  enquiryPlanned: number; enquiryActual: number; perCanopy: number; hot: number;
  trPlanned: number; trActual: number; trPerCanopy: number;
  bookToday: number; bookInHand: number;
  retailToday: number; retailMtdAct: number; retailMtd: number; retailRatePerCanopy: number;
  activityDay: number; closingStock: number;
  leads: number; punched: number; gap: number; convPct: number;
}

const DAILY_SUMMARY: DailySummaryRow[] = [
  {sr:1,dealer:"Shirdi Eco Wheels",location:"Ajmer",state:"RJ",zone:"North",bgMember:"Dhanraj",canopy:2,enquiryPlanned:70,enquiryActual:62,perCanopy:31,hot:3,trPlanned:60,trActual:42,trPerCanopy:21,bookToday:2,bookInHand:0,retailToday:2,retailMtdAct:6,retailMtd:6,retailRatePerCanopy:1.2,activityDay:3,closingStock:40,leads:154,punched:99,gap:55,convPct:4},
  {sr:2,dealer:"Dimpal",location:"Jhunjhunu",state:"RJ",zone:"North",bgMember:"Santosh",canopy:2,enquiryPlanned:70,enquiryActual:41,perCanopy:21,hot:2,trPlanned:60,trActual:31,trPerCanopy:16,bookToday:1,bookInHand:0,retailToday:1,retailMtdAct:6,retailMtd:6,retailRatePerCanopy:1.0,activityDay:3,closingStock:68,leads:140,punched:8,gap:132,convPct:4},
  {sr:3,dealer:"Dimpal",location:"Churu",state:"RJ",zone:"North",bgMember:"Santosh",canopy:1,enquiryPlanned:35,enquiryActual:28,perCanopy:28,hot:2,trPlanned:30,trActual:22,trPerCanopy:22,bookToday:0,bookInHand:1,retailToday:0,retailMtdAct:0,retailMtd:0,retailRatePerCanopy:0.0,activityDay:3,closingStock:10,leads:80,punched:0,gap:80,convPct:0},
  {sr:4,dealer:"Omashwani",location:"Rewa",state:"MP",zone:"West",bgMember:"Sandeep",canopy:1,enquiryPlanned:35,enquiryActual:13,perCanopy:13,hot:1,trPlanned:30,trActual:10,trPerCanopy:10,bookToday:0,bookInHand:0,retailToday:0,retailMtdAct:0,retailMtd:0,retailRatePerCanopy:0.0,activityDay:3,closingStock:13,leads:42,punched:29,gap:13,convPct:0},
  {sr:5,dealer:"Karni",location:"Nagaur",state:"RJ",zone:"North",bgMember:"Jitendra",canopy:1,enquiryPlanned:35,enquiryActual:27,perCanopy:27,hot:2,trPlanned:30,trActual:20,trPerCanopy:20,bookToday:0,bookInHand:0,retailToday:0,retailMtdAct:2,retailMtd:3,retailRatePerCanopy:0.7,activityDay:3,closingStock:14,leads:77,punched:2,gap:75,convPct:3},
  {sr:6,dealer:"RBS",location:"Rajkot",state:"GJ",zone:"North",bgMember:"Parag",canopy:2,enquiryPlanned:30,enquiryActual:7,perCanopy:7,hot:2,trPlanned:5,trActual:5,trPerCanopy:5,bookToday:2,bookInHand:0,retailToday:2,retailMtdAct:4,retailMtd:4,retailRatePerCanopy:1.3,activityDay:3,closingStock:9,leads:18,punched:0,gap:18,convPct:22},
  {sr:7,dealer:"Radha Raman",location:"Sagar",state:"MP",zone:"West",bgMember:"Prince",canopy:1,enquiryPlanned:35,enquiryActual:13,perCanopy:13,hot:1,trPlanned:30,trActual:13,trPerCanopy:13,bookToday:0,bookInHand:0,retailToday:0,retailMtdAct:0,retailMtd:0,retailRatePerCanopy:0.0,activityDay:2,closingStock:19,leads:29,punched:2,gap:27,convPct:0},
  {sr:8,dealer:"Shrey",location:"Secunderabad",state:"TG",zone:"South",bgMember:"Ashiq",canopy:1,enquiryPlanned:35,enquiryActual:11,perCanopy:11,hot:1,trPlanned:30,trActual:9,trPerCanopy:9,bookToday:1,bookInHand:0,retailToday:1,retailMtdAct:2,retailMtd:4,retailRatePerCanopy:1.0,activityDay:2,closingStock:15,leads:20,punched:20,gap:0,convPct:10},
  {sr:9,dealer:"Anjani",location:"Sujangarh",state:"RJ",zone:"North",bgMember:"Rohit",canopy:1,enquiryPlanned:35,enquiryActual:24,perCanopy:24,hot:1,trPlanned:30,trActual:22,trPerCanopy:22,bookToday:1,bookInHand:0,retailToday:1,retailMtdAct:3,retailMtd:5,retailRatePerCanopy:1.5,activityDay:2,closingStock:47,leads:46,punched:1,gap:45,convPct:7},
  {sr:10,dealer:"Shree Shyam",location:"Gurgaon",state:"HR",zone:"North",bgMember:"Kamal",canopy:1,enquiryPlanned:35,enquiryActual:22,perCanopy:22,hot:1,trPlanned:30,trActual:17,trPerCanopy:17,bookToday:0,bookInHand:0,retailToday:0,retailMtdAct:0,retailMtd:1,retailRatePerCanopy:0.0,activityDay:2,closingStock:48,leads:43,punched:34,gap:9,convPct:0},
  {sr:11,dealer:"AK Enterprises",location:"Moradabad",state:"UP",zone:"North",bgMember:"Manish",canopy:1,enquiryPlanned:35,enquiryActual:15,perCanopy:15,hot:1,trPlanned:30,trActual:11,trPerCanopy:11,bookToday:1,bookInHand:1,retailToday:0,retailMtdAct:0,retailMtd:1,retailRatePerCanopy:0.0,activityDay:1,closingStock:9,leads:15,punched:4,gap:11,convPct:0},
  {sr:12,dealer:"Vijayvargiya",location:"Shivpuri",state:"MP",zone:"West",bgMember:"Aditya",canopy:1,enquiryPlanned:35,enquiryActual:15,perCanopy:15,hot:1,trPlanned:30,trActual:10,trPerCanopy:10,bookToday:0,bookInHand:0,retailToday:0,retailMtdAct:0,retailMtd:2,retailRatePerCanopy:0.0,activityDay:1,closingStock:18,leads:15,punched:12,gap:3,convPct:0},
  {sr:13,dealer:"JK Auto",location:"Morbi",state:"GJ",zone:"North",bgMember:"Ruchit",canopy:1,enquiryPlanned:35,enquiryActual:17,perCanopy:17,hot:1,trPlanned:30,trActual:10,trPerCanopy:10,bookToday:0,bookInHand:0,retailToday:0,retailMtdAct:0,retailMtd:2,retailRatePerCanopy:0.0,activityDay:1,closingStock:12,leads:17,punched:2,gap:15,convPct:0},
  {sr:14,dealer:"Ashish Motors",location:"Deoria",state:"UP",zone:"North",bgMember:"Sheo Mangal",canopy:1,enquiryPlanned:35,enquiryActual:21,perCanopy:21,hot:1,trPlanned:30,trActual:13,trPerCanopy:13,bookToday:0,bookInHand:0,retailToday:0,retailMtdAct:0,retailMtd:0,retailRatePerCanopy:0.0,activityDay:1,closingStock:19,leads:21,punched:17,gap:4,convPct:0},
  {sr:15,dealer:"CS Auto",location:"Anantpur",state:"AP",zone:"South",bgMember:"Pavan",canopy:1,enquiryPlanned:35,enquiryActual:8,perCanopy:8,hot:1,trPlanned:30,trActual:6,trPerCanopy:6,bookToday:1,bookInHand:0,retailToday:1,retailMtdAct:1,retailMtd:2,retailRatePerCanopy:1.0,activityDay:1,closingStock:20,leads:8,punched:2,gap:6,convPct:13},
  {sr:16,dealer:"Urban Riders",location:"Bareilly",state:"UP",zone:"North",bgMember:"Awdhesh",canopy:1,enquiryPlanned:35,enquiryActual:21,perCanopy:21,hot:1,trPlanned:30,trActual:15,trPerCanopy:15,bookToday:0,bookInHand:0,retailToday:0,retailMtdAct:0,retailMtd:2,retailRatePerCanopy:0.0,activityDay:1,closingStock:11,leads:21,punched:0,gap:21,convPct:0},
  {sr:17,dealer:"Batra",location:"Nagpur",state:"MH",zone:"West",bgMember:"Harish",canopy:1,enquiryPlanned:35,enquiryActual:20,perCanopy:20,hot:1,trPlanned:30,trActual:15,trPerCanopy:15,bookToday:1,bookInHand:1,retailToday:1,retailMtdAct:1,retailMtd:2,retailRatePerCanopy:1.0,activityDay:1,closingStock:35,leads:20,punched:0,gap:20,convPct:5},
  {sr:18,dealer:"Rajlaxmi",location:"Jalgaon - M",state:"MH",zone:"West",bgMember:"Muzammil",canopy:1,enquiryPlanned:35,enquiryActual:25,perCanopy:25,hot:5,trPlanned:30,trActual:25,trPerCanopy:25,bookToday:5,bookInHand:3,retailToday:2,retailMtdAct:2,retailMtd:16,retailRatePerCanopy:2.0,activityDay:1,closingStock:27,leads:25,punched:0,gap:25,convPct:8},
  {sr:19,dealer:"Marudhar",location:"Jodhpur",state:"RJ",zone:"North",bgMember:"Jitendra",canopy:1,enquiryPlanned:35,enquiryActual:24,perCanopy:24,hot:1,trPlanned:30,trActual:18,trPerCanopy:18,bookToday:0,bookInHand:0,retailToday:0,retailMtdAct:0,retailMtd:1,retailRatePerCanopy:0.0,activityDay:1,closingStock:14,leads:24,punched:0,gap:24,convPct:0},
  {sr:20,dealer:"Shiv Krishna",location:"Morena",state:"MP",zone:"West",bgMember:"Aditya",canopy:1,enquiryPlanned:35,enquiryActual:15,perCanopy:15,hot:1,trPlanned:30,trActual:10,trPerCanopy:10,bookToday:0,bookInHand:0,retailToday:0,retailMtdAct:0,retailMtd:1,retailRatePerCanopy:0.0,activityDay:1,closingStock:7,leads:15,punched:12,gap:3,convPct:0},
];

// ─── Mock: Lead Report data (from Image 3) ────────────────────────────────────
interface LeadReportRow {
  state: string; expectedLeads: number;
  walkinTarget: number; walkinMtdT: number; walkinMtdA: number;
  btlTarget: number; btlMtdT: number; btlMtdA: number;
  referralTarget: number; referralMtdT: number; referralMtdA: number;
  atlTarget: number; atlMtdT: number; atlMtdA: number;
  digitalTarget: number; digitalMtdT: number; digitalMtdA: number;
  totalReceived: number; variance: number; achPct: number;
  jul26RetailTarget: number; mtdRetailTarget: number; mtdRetailAch: number;
  mtdRetailAchPct: number; retailEnqPct: number;
}

const LEAD_REPORT: LeadReportRow[] = [
  {state:"Telangana",expectedLeads:470,walkinTarget:50,walkinMtdT:5,walkinMtdA:16,btlTarget:150,btlMtdT:15,btlMtdA:20,referralTarget:0,referralMtdT:0,referralMtdA:0,atlTarget:0,atlMtdT:0,atlMtdA:5,digitalTarget:270,digitalMtdT:27,digitalMtdA:30,totalReceived:71,variance:-399,achPct:15,jul26RetailTarget:35,mtdRetailTarget:4,mtdRetailAch:4,mtdRetailAchPct:100,retailEnqPct:6},
  {state:"Delhi",expectedLeads:1000,walkinTarget:30,walkinMtdT:3,walkinMtdA:0,btlTarget:470,btlMtdT:46,btlMtdA:0,referralTarget:0,referralMtdT:0,referralMtdA:0,atlTarget:0,atlMtdT:0,atlMtdA:0,digitalTarget:500,digitalMtdT:49,digitalMtdA:132,totalReceived:132,variance:-868,achPct:13,jul26RetailTarget:30,mtdRetailTarget:3,mtdRetailAch:0,mtdRetailAchPct:0,retailEnqPct:0},
  {state:"Gujarat",expectedLeads:4250,walkinTarget:200,walkinMtdT:20,walkinMtdA:25,btlTarget:2000,btlMtdT:194,btlMtdA:106,referralTarget:50,referralMtdT:5,referralMtdA:6,atlTarget:0,atlMtdT:0,atlMtdA:20,digitalTarget:2000,digitalMtdT:194,digitalMtdA:210,totalReceived:367,variance:-3883,achPct:9,jul26RetailTarget:175,mtdRetailTarget:17,mtdRetailAch:34,mtdRetailAchPct:200,retailEnqPct:9},
  {state:"Tamil Nadu",expectedLeads:8650,walkinTarget:800,walkinMtdT:78,walkinMtdA:186,btlTarget:1770,btlMtdT:172,btlMtdA:57,referralTarget:80,referralMtdT:8,referralMtdA:4,atlTarget:200,atlMtdT:20,atlMtdA:32,digitalTarget:5800,digitalMtdT:562,digitalMtdA:459,totalReceived:738,variance:-7912,achPct:9,jul26RetailTarget:610,mtdRetailTarget:60,mtdRetailAch:57,mtdRetailAchPct:95,retailEnqPct:8},
  {state:"Haryana",expectedLeads:750,walkinTarget:30,walkinMtdT:3,walkinMtdA:0,btlTarget:220,btlMtdT:22,btlMtdA:50,referralTarget:0,referralMtdT:0,referralMtdA:0,atlTarget:0,atlMtdT:0,atlMtdA:0,digitalTarget:500,digitalMtdT:49,digitalMtdA:12,totalReceived:62,variance:-688,achPct:8,jul26RetailTarget:15,mtdRetailTarget:2,mtdRetailAch:1,mtdRetailAchPct:50,retailEnqPct:2},
  {state:"Karnataka",expectedLeads:1200,walkinTarget:200,walkinMtdT:20,walkinMtdA:20,btlTarget:330,btlMtdT:32,btlMtdA:7,referralTarget:20,referralMtdT:2,referralMtdA:1,atlTarget:120,atlMtdT:12,atlMtdA:9,digitalTarget:530,digitalMtdT:52,digitalMtdA:47,totalReceived:84,variance:-1116,achPct:7,jul26RetailTarget:180,mtdRetailTarget:18,mtdRetailAch:28,mtdRetailAchPct:156,retailEnqPct:33},
  {state:"Kerala",expectedLeads:1700,walkinTarget:90,walkinMtdT:9,walkinMtdA:2,btlTarget:0,btlMtdT:0,btlMtdA:3,referralTarget:10,referralMtdT:1,referralMtdA:1,atlTarget:0,atlMtdT:0,atlMtdA:0,digitalTarget:1600,digitalMtdT:155,digitalMtdA:96,totalReceived:102,variance:-1598,achPct:6,jul26RetailTarget:60,mtdRetailTarget:6,mtdRetailAch:1,mtdRetailAchPct:17,retailEnqPct:1},
  {state:"Madhya Pradesh",expectedLeads:6500,walkinTarget:200,walkinMtdT:20,walkinMtdA:32,btlTarget:1745,btlMtdT:169,btlMtdA:195,referralTarget:5,referralMtdT:1,referralMtdA:0,atlTarget:1550,atlMtdT:150,atlMtdA:17,digitalTarget:3000,digitalMtdT:291,digitalMtdA:111,totalReceived:355,variance:-6145,achPct:5,jul26RetailTarget:120,mtdRetailTarget:12,mtdRetailAch:25,mtdRetailAchPct:208,retailEnqPct:7},
  {state:"Maharashtra",expectedLeads:11825,walkinTarget:800,walkinMtdT:78,walkinMtdA:90,btlTarget:10100,btlMtdT:978,btlMtdA:234,referralTarget:75,referralMtdT:8,referralMtdA:5,atlTarget:0,atlMtdT:0,atlMtdA:16,digitalTarget:850,digitalMtdT:83,digitalMtdA:137,totalReceived:482,variance:-11343,achPct:4,jul26RetailTarget:630,mtdRetailTarget:61,mtdRetailAch:83,mtdRetailAchPct:136,retailEnqPct:17},
  {state:"Rajasthan",expectedLeads:6750,walkinTarget:250,walkinMtdT:25,walkinMtdA:17,btlTarget:3725,btlMtdT:361,btlMtdA:110,referralTarget:25,referralMtdT:3,referralMtdA:6,atlTarget:0,atlMtdT:0,atlMtdA:0,digitalTarget:2750,digitalMtdT:267,digitalMtdA:129,totalReceived:262,variance:-6488,achPct:4,jul26RetailTarget:250,mtdRetailTarget:25,mtdRetailAch:42,mtdRetailAchPct:168,retailEnqPct:16},
  {state:"Andhra Pradesh",expectedLeads:1135,walkinTarget:150,walkinMtdT:15,walkinMtdA:17,btlTarget:265,btlMtdT:26,btlMtdA:11,referralTarget:5,referralMtdT:1,referralMtdA:0,atlTarget:20,atlMtdT:2,atlMtdA:0,digitalTarget:695,digitalMtdT:68,digitalMtdA:14,totalReceived:42,variance:-1093,achPct:4,jul26RetailTarget:65,mtdRetailTarget:7,mtdRetailAch:8,mtdRetailAchPct:114,retailEnqPct:19},
  {state:"Chhattisgarh",expectedLeads:3000,walkinTarget:100,walkinMtdT:10,walkinMtdA:22,btlTarget:1390,btlMtdT:135,btlMtdA:27,referralTarget:10,referralMtdT:1,referralMtdA:0,atlTarget:250,atlMtdT:25,atlMtdA:4,digitalTarget:1250,digitalMtdT:121,digitalMtdA:32,totalReceived:85,variance:-2915,achPct:3,jul26RetailTarget:65,mtdRetailTarget:7,mtdRetailAch:7,mtdRetailAchPct:100,retailEnqPct:8},
  {state:"Uttarakhand",expectedLeads:1350,walkinTarget:50,walkinMtdT:5,walkinMtdA:2,btlTarget:1300,btlMtdT:126,btlMtdA:0,referralTarget:0,referralMtdT:0,referralMtdA:0,atlTarget:0,atlMtdT:0,atlMtdA:0,digitalTarget:0,digitalMtdT:0,digitalMtdA:29,totalReceived:31,variance:-1319,achPct:2,jul26RetailTarget:30,mtdRetailTarget:3,mtdRetailAch:3,mtdRetailAchPct:100,retailEnqPct:10},
  {state:"Uttar Pradesh",expectedLeads:7960,walkinTarget:200,walkinMtdT:20,walkinMtdA:6,btlTarget:7270,btlMtdT:704,btlMtdA:24,referralTarget:10,referralMtdT:1,referralMtdA:0,atlTarget:0,atlMtdT:0,atlMtdA:0,digitalTarget:480,digitalMtdT:47,digitalMtdA:140,totalReceived:170,variance:-7790,achPct:2,jul26RetailTarget:160,mtdRetailTarget:16,mtdRetailAch:12,mtdRetailAchPct:75,retailEnqPct:7},
  {state:"Odisha",expectedLeads:1670,walkinTarget:70,walkinMtdT:7,walkinMtdA:17,btlTarget:400,btlMtdT:39,btlMtdA:0,referralTarget:0,referralMtdT:0,referralMtdA:0,atlTarget:0,atlMtdT:0,atlMtdA:0,digitalTarget:1200,digitalMtdT:117,digitalMtdA:10,totalReceived:27,variance:-1643,achPct:2,jul26RetailTarget:60,mtdRetailTarget:6,mtdRetailAch:5,mtdRetailAchPct:83,retailEnqPct:19},
  {state:"Jharkhand",expectedLeads:800,walkinTarget:20,walkinMtdT:2,walkinMtdA:11,btlTarget:180,btlMtdT:18,btlMtdA:0,referralTarget:0,referralMtdT:0,referralMtdA:1,atlTarget:0,atlMtdT:0,atlMtdA:0,digitalTarget:600,digitalMtdT:59,digitalMtdA:0,totalReceived:12,variance:-788,achPct:2,jul26RetailTarget:15,mtdRetailTarget:2,mtdRetailAch:1,mtdRetailAchPct:50,retailEnqPct:8},
];

// ─── Mock: Dealer Daily sheet (from Image 1 — Shirdi Eco Ajmer) ───────────────
interface DealerDayRow {
  date: string; openingStock?: number; canopy?: number;
  enquiryPlanned: number; enquiryActual?: number; walkIn?: number;
  inLms?: number; gap?: number; hot?: number; revisedHot?: number;
  trPlanned: number; trActual?: number;
  bookToday?: number; bookInHand?: number;
  retail?: number; mtdRetail?: number;
}
const DEALER_DAILY: DealerDayRow[] = [
  {date:"01-07-2026",openingStock:46,canopy:1,enquiryPlanned:35,enquiryActual:32,walkIn:5,inLms:1,gap:-31,hot:5,revisedHot:4,trPlanned:30,trActual:22,bookToday:4,bookInHand:0,retail:4,mtdRetail:4},
  {date:"02-07-2026",openingStock:42,canopy:2,enquiryPlanned:70,enquiryActual:60,walkIn:4,inLms:1,gap:-59,hot:4,revisedHot:1,trPlanned:60,trActual:41,bookToday:0,bookInHand:0,retail:0,mtdRetail:4},
  {date:"03-07-2026",openingStock:42,canopy:2,enquiryPlanned:70,enquiryActual:62,walkIn:5,inLms:97,gap:35,hot:5,revisedHot:3,trPlanned:60,trActual:42,bookToday:2,bookInHand:0,retail:2,mtdRetail:6},
  {date:"04-07-2026",openingStock:40,canopy:undefined,enquiryPlanned:0,enquiryActual:undefined,trPlanned:0},
  {date:"05-07-2026",enquiryPlanned:0,trPlanned:0},
  {date:"06-07-2026",enquiryPlanned:0,trPlanned:0},
  {date:"07-07-2026",enquiryPlanned:0,trPlanned:0},
  {date:"08-07-2026",enquiryPlanned:0,trPlanned:0},
  {date:"09-07-2026",enquiryPlanned:0,trPlanned:0},
  {date:"10-07-2026",enquiryPlanned:0,trPlanned:0},
  {date:"11-07-2026",enquiryPlanned:0,trPlanned:0},
  {date:"12-07-2026",enquiryPlanned:0,trPlanned:0},
  {date:"13-07-2026",enquiryPlanned:0,trPlanned:0},
  {date:"14-07-2026",enquiryPlanned:0,trPlanned:0},
  {date:"15-07-2026",enquiryPlanned:0,trPlanned:0},
  {date:"16-07-2026",enquiryPlanned:0,trPlanned:0},
  {date:"17-07-2026",enquiryPlanned:0,trPlanned:0},
  {date:"18-07-2026",enquiryPlanned:0,trPlanned:0},
  {date:"19-07-2026",enquiryPlanned:0,trPlanned:0},
];

// ─── Types ─────────────────────────────────────────────────────────────────────
type ActiveFilter = "All" | "Pending" | "Approved" | "Rejected";

interface SummaryStats {
  totalProposals: number; pendingCount: number; approvedCount: number;
  rejectedCount: number; totalBudget: number; approvedBudget: number;
  pendingBudget: number; totalRetailTarget: number; totalLeadTarget: number;
  avgCac: number; avgCpl: number; stateCount: number; dealerCount: number;
}

function computeStats(proposals: ProposalResponse[]): SummaryStats {
  const approved = proposals.filter((p) => p.status === "Approved");
  const pending  = proposals.filter((p) => p.status === "Pending");
  const cacList  = proposals.filter((p) => p.cac > 0).map((p) => p.cac);
  const cplList  = proposals.filter((p) => p.cpl > 0).map((p) => p.cpl);
  return {
    totalProposals: proposals.length,
    pendingCount:   pending.length,
    approvedCount:  approved.length,
    rejectedCount:  proposals.filter((p) => p.status === "Rejected").length,
    totalBudget:    proposals.reduce((s, p) => s + p.totalBudget, 0),
    approvedBudget: approved.reduce((s, p) => s + p.totalBudget, 0),
    pendingBudget:  pending.reduce((s, p)  => s + p.totalBudget, 0),
    totalRetailTarget: proposals.reduce((s, p) => s + p.totalRetailTarget, 0),
    totalLeadTarget:   proposals.reduce((s, p) => s + p.totalLeadTarget, 0),
    avgCac: cacList.length > 0 ? cacList.reduce((a, b) => a + b, 0) / cacList.length : 0,
    avgCpl: cplList.length > 0 ? cplList.reduce((a, b) => a + b, 0) / cplList.length : 0,
    stateCount:  new Set(proposals.map((p) => p.state)).size,
    dealerCount: new Set(proposals.map((p) => p.dealerName)).size,
  };
}

// ─── Color helpers ────────────────────────────────────────────────────────────
function cellColor(actual: number, planned: number): string {
  if (!planned || !actual) return "";
  const r = actual / planned;
  if (r >= 0.9) return "#d1fae5";
  if (r >= 0.6) return "#fef3c7";
  return "#fee2e2";
}
function achColor(p: number): string {
  if (p >= 100) return "#bbf7d0";
  if (p >= 50)  return "#fef3c7";
  return "#fecaca";
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
// ── Print/PDF helper — prints the target table in a clean PDF-ready view ────
function printSection(sectionId: string, title: string) {
  const el = document.getElementById(sectionId);
  if (!el) return;

  const printWindow = window.open("", "_blank", "width=1200,height=900");
  if (!printWindow) { alert("Allow pop-ups to download PDF."); return; }

  const styles = Array.from(document.styleSheets)
    .flatMap((ss) => {
      try { return Array.from(ss.cssRules).map((r) => r.cssText); }
      catch { return []; }
    })
    .join("\n");

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <meta charset="UTF-8"/>
      <style>
        ${styles}
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; margin: 0; background: #fff; }
        .print-header { background: #0a2540; color: #fff; padding: 14px 20px; margin-bottom: 16px; border-radius: 6px; }
        .print-header h1 { margin: 0; font-size: 16px; font-weight: 700; }
        .print-header p  { margin: 4px 0 0; font-size: 11px; opacity: 0.75; }
        table { border-collapse: collapse; width: 100%; font-size: 10px; }
        th, td { border: 1px solid #e2e8f0; padding: 4px 6px; }
        th { background: #0a2540 !important; color: #fff !important; font-size: 9px; }
        tr:nth-child(even) { background: #f8fafc; }
        @page { size: A3 landscape; margin: 1cm; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      </style>
    </head>
    <body>
      <div class="print-header">
        <h1>BGauss BTL — ${title}</h1>
        <p>Generated: ${new Date().toLocaleString("en-IN")}</p>
      </div>
      ${el.outerHTML}
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
}

export default function DashboardPage() {
  const { user, loading } = useAuthStore();
  const { instance }      = useMsal();
  const navigate          = useNavigate();
  const isAdmin           = user?.role === "Admin" || user?.role === "Manager";

  const [proposals,    setProposals]    = useState<ProposalResponse[]>([]);
  const [loadingData,  setLoadingData]  = useState(true);
  const [dataError,    setDataError]    = useState<string | null>(null);
  const [baplCounts,   setBaplCounts]   = useState<DealerStateCount[]>([]);
  const [downloading,  setDownloading]  = useState<"excel" | "pdf" | null>(null);
  const [dlError,      setDlError]      = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("All");
  const [stateFilter,  setStateFilter]  = useState("All");
  const [monthFilter,  setMonthFilter]  = useState("All");
  const [sharedSearch, setSharedSearch] = useState("");

  // ── Report tab state (Admin only) ──────────────────────────────────────────
  const [reportTab,           setReportTab]           = useState<ReportTab>("overview");
  const [selectedDealerDaily, setSelectedDealerDaily] = useState<DailySummaryRow | null>(null);

  useEffect(() => {
    if (loading) return;
    setLoadingData(true);
    const loader = isAdmin ? fetchProposals(instance) : fetchMyProposals(instance);
    Promise.all([
      loader,
      fetchDealerStateCounts(instance).catch(() => [] as DealerStateCount[]),
    ]).then(([props, counts]) => {
      setProposals(props);
      setBaplCounts(counts);
    }).catch((e) => setDataError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoadingData(false));
  }, [loading, instance, isAdmin]);

  const states = useMemo(
    () => ["All", ...Array.from(new Set(proposals.map((p) => p.state))).sort()],
    [proposals],
  );
  const months = useMemo(
    () => ["All", ...Array.from(new Set(proposals.map((p) => p.month)))],
    [proposals],
  );

  const handleKpiClick = (filter: ActiveFilter) =>
    setActiveFilter((prev) => (prev === filter ? "All" : filter));

  const baseFiltered = useMemo(() =>
    proposals.filter((p) => {
      if (activeFilter !== "All" && p.status !== activeFilter) return false;
      if (stateFilter  !== "All" && p.state  !== stateFilter)  return false;
      if (monthFilter  !== "All" && p.month  !== monthFilter)   return false;
      return true;
    }),
  [proposals, activeFilter, stateFilter, monthFilter]);

  // ── POINT 4: KPI cards reflect filtered set when any filter is active ──────
  const hasActiveFilter = activeFilter !== "All" || stateFilter !== "All" || monthFilter !== "All";
  const stats = useMemo(
    () => computeStats(hasActiveFilter ? baseFiltered : proposals),
    [baseFiltered, proposals, hasActiveFilter],
  );

  const searchFiltered = useMemo(() => {
    const q = sharedSearch.toLowerCase().trim();
    if (!q) return baseFiltered;
    return baseFiltered.filter((p) =>
      [p.state, p.dealerName, p.rsmName, p.location, p.month]
        .join(" ").toLowerCase().includes(q),
    );
  }, [baseFiltered, sharedSearch]);

  const currentReportFilters = useMemo((): ReportFilters => ({
    period: "monthly",
    state:  stateFilter !== "All" ? stateFilter : undefined,
  }), [stateFilter]);

  const handleDownload = async (type: "excel" | "pdf") => {
    setDownloading(type); setDlError(null);
    try {
      if (type === "excel") await downloadExcelReport(currentReportFilters, instance);
      else                  await downloadPdfReport(currentReportFilters, instance);
    } catch (e) { setDlError(e instanceof Error ? e.message : "Download failed."); }
    finally { setDownloading(null); }
  };

  // ── State breakdown — POINT 7: includes revision count ────────────────────
  const stateBreakdown = useMemo(() => {
    interface StateRow {
      oldDealers: Set<string>; oldRetail: number; oldLead: number; oldBudget: number;
      newDealers: Set<string>; newRetail: number; newLead: number; newBudget: number;
      nonDealers: Set<string>; nonRetail: number; nonLead: number; nonBudget: number;
      pending: number; approved: number; rejected: number;
      revision: number; // ← ADDED Point #7
      remarks: string;
    }
    const map: Record<string, StateRow> = {};
    const ensure = (state: string) => {
      if (!map[state]) map[state] = {
        oldDealers: new Set(), oldRetail: 0, oldLead: 0, oldBudget: 0,
        newDealers: new Set(), newRetail: 0, newLead: 0, newBudget: 0,
        nonDealers: new Set(), nonRetail: 0, nonLead: 0, nonBudget: 0,
        pending: 0, approved: 0, rejected: 0,
        revision: 0, // ← ADDED Point #7
        remarks: "",
      };
    };

    for (const p of searchFiltered) {
      ensure(p.state);
      const r  = map[p.state];
      const ty = (p.type ?? "").toLowerCase();
      const el = (p.eligibility ?? "").toLowerCase();
      if (el.includes("not") || el.includes("non")) {
        r.nonDealers.add(p.dealerName);
        r.nonRetail += p.totalRetailTarget;
        r.nonLead   += p.totalLeadTarget;
        r.nonBudget += p.totalBudget;
      } else if (ty === "new") {
        r.newDealers.add(p.dealerName);
        r.newRetail += p.totalRetailTarget;
        r.newLead   += p.totalLeadTarget;
        r.newBudget += p.totalBudget;
      } else {
        r.oldDealers.add(p.dealerName);
        r.oldRetail += p.totalRetailTarget;
        r.oldLead   += p.totalLeadTarget;
        r.oldBudget += p.totalBudget;
      }
      if (p.status === "Pending")       r.pending++;
      if (p.status === "Approved")      r.approved++;
      if (p.status === "Rejected")      r.rejected++;
      if (p.status === "NeedsRevision") r.revision++; // ← ADDED Point #7
      if (p.remarks) r.remarks = p.remarks;
    }

    const baplByState = Object.fromEntries(
      baplCounts.map(c => [c.state.toLowerCase(), c]),
    );
    for (const bc of baplCounts) {
      if (!map[bc.state]) map[bc.state] = {
        oldDealers: new Set(), oldRetail: 0, oldLead: 0, oldBudget: 0,
        newDealers: new Set(), newRetail: 0, newLead: 0, newBudget: 0,
        nonDealers: new Set(), nonRetail: 0, nonLead: 0, nonBudget: 0,
        pending: 0, approved: 0, rejected: 0, revision: 0, remarks: "",
      };
    }

    return Object.entries(map).map(([state, d]) => {
      const bapl             = baplByState[state.toLowerCase()];
      const nonCountFromBapl = bapl?.nonEligible ?? 0;
      const nonCountFinal    = Math.max(d.nonDealers.size, nonCountFromBapl);
      const oldCountFinal    = Math.max(d.oldDealers.size, bapl?.eligibleOld ?? 0);
      const newCountFinal    = Math.max(d.newDealers.size, bapl?.eligibleNew ?? 0);
      const totalDealers     = oldCountFinal + newCountFinal + nonCountFinal;
      const totalBudget      = d.oldBudget + d.newBudget;
      const totalRetail      = d.oldRetail + d.newRetail + d.nonRetail;
      const totalLead        = d.oldLead + d.newLead + d.nonLead;
      return {
        state,
        oldRetail: d.oldRetail, oldCount: oldCountFinal, oldBudget: d.oldBudget,
        oldCac: d.oldRetail > 0 ? d.oldBudget / d.oldRetail : 0,
        newRetail: d.newRetail, newCount: newCountFinal, newBudget: d.newBudget,
        newCac: d.newRetail > 0 ? d.newBudget / d.newRetail : 0,
        nonRetail: d.nonRetail, nonCount: nonCountFinal, nonBudget: d.nonBudget,
        nonCac: d.nonRetail > 0 ? d.nonBudget / d.nonRetail : 0,
        totalDealers, totalBudget, totalRetail, totalLead,
        overallCac: totalRetail > 0 ? totalBudget / totalRetail : 0,
        overallCpl: totalLead   > 0 ? totalBudget / totalLead   : 0,
        pending: d.pending, approved: d.approved, rejected: d.rejected,
        revision: d.revision, // ← ADDED Point #7
        remarks: d.remarks,
        baplEligibleOld: bapl?.eligibleOld ?? 0,
        baplEligibleNew: bapl?.eligibleNew ?? 0,
        baplNonEligible: nonCountFromBapl,
      };
    }).sort((a, b) => a.state.localeCompare(b.state));
  }, [searchFiltered, baplCounts]);

  const stateGrandTotal = useMemo(() => {
    if (!stateBreakdown.length) return null;
    return {
      oldRetail:    stateBreakdown.reduce((s, r) => s + r.oldRetail,    0),
      oldCount:     stateBreakdown.reduce((s, r) => s + r.oldCount,     0),
      oldBudget:    stateBreakdown.reduce((s, r) => s + r.oldBudget,    0),
      newRetail:    stateBreakdown.reduce((s, r) => s + r.newRetail,    0),
      newCount:     stateBreakdown.reduce((s, r) => s + r.newCount,     0),
      newBudget:    stateBreakdown.reduce((s, r) => s + r.newBudget,    0),
      nonRetail:    stateBreakdown.reduce((s, r) => s + r.nonRetail,    0),
      nonCount:     stateBreakdown.reduce((s, r) => s + r.nonCount,     0),
      nonBudget:    stateBreakdown.reduce((s, r) => s + r.nonBudget,    0),
      totalDealers: stateBreakdown.reduce((s, r) => s + r.totalDealers, 0),
      totalBudget:  stateBreakdown.reduce((s, r) => s + r.totalBudget,  0),
      totalRetail:  stateBreakdown.reduce((s, r) => s + r.totalRetail,  0),
      totalLead:    stateBreakdown.reduce((s, r) => s + r.totalLead,    0),
    };
  }, [stateBreakdown]);

  const dealerRows = useMemo(() => {
    const map: Record<string, {
      state: string; dealerName: string; monthTarget: number;
      eligibleOldBudget: number; eligibleNewBudget: number; nonBudget: number;
      retailTarget: number; leadTarget: number; activities: number;
      eligibility: string; type: string;
      pending: number; approved: number; rejected: number;
      activityNames: Set<string>;
    }> = {};
    for (const p of searchFiltered) {
      const key = `${p.dealerName}__${p.state}`;
      if (!map[key]) map[key] = {
        state: p.state, dealerName: p.dealerName, monthTarget: 0,
        eligibleOldBudget: 0, eligibleNewBudget: 0, nonBudget: 0,
        retailTarget: 0, leadTarget: 0, activities: 0,
        eligibility: p.eligibility ?? "", type: p.type ?? "",
        pending: 0, approved: 0, rejected: 0,
        activityNames: new Set<string>(),
      };
      const d  = map[key];
      const ty = (p.type ?? "").toLowerCase();
      const el = (p.eligibility ?? "").toLowerCase();
      d.monthTarget  += p.totalRetailTarget;
      d.retailTarget += p.totalRetailTarget;
      d.leadTarget   += p.totalLeadTarget;
      d.activities   += p.activities.length;
      p.activities.forEach(a => { if (a.activityType) d.activityNames.add(a.activityType); });
      if (el.includes("not") || el.includes("non")) d.nonBudget         += p.totalBudget;
      else if (ty === "new")                         d.eligibleNewBudget += p.totalBudget;
      else                                           d.eligibleOldBudget += p.totalBudget;
      if (p.status === "Pending")  d.pending++;
      if (p.status === "Approved") d.approved++;
      if (p.status === "Rejected") d.rejected++;
      d.eligibility = p.eligibility ?? d.eligibility;
      d.type        = p.type        ?? d.type;
    }
    return Object.values(map).sort(
      (a, b) => a.state.localeCompare(b.state) || a.dealerName.localeCompare(b.dealerName),
    );
  }, [searchFiltered]);

  const searchResultLabel = useMemo(() => {
    if (!sharedSearch.trim()) return null;
    return `${stateBreakdown.length} state${stateBreakdown.length !== 1 ? "s" : ""} · ${dealerRows.length} dealer${dealerRows.length !== 1 ? "s" : ""} matching "${sharedSearch}"`;
  }, [sharedSearch, stateBreakdown.length, dealerRows.length]);

  const activeFilterCount = [
    activeFilter !== "All",
    stateFilter  !== "All",
    monthFilter  !== "All",
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setActiveFilter("All"); setStateFilter("All");
    setMonthFilter("All");  setSharedSearch("");
  };

  // Daily summary totals
  const dsTotals = useMemo(() => ({
    canopy:          DAILY_SUMMARY.reduce((s, r) => s + r.canopy, 0),
    enquiryPlanned:  DAILY_SUMMARY.reduce((s, r) => s + r.enquiryPlanned, 0),
    enquiryActual:   DAILY_SUMMARY.reduce((s, r) => s + r.enquiryActual, 0),
    perCanopy:       Math.round(DAILY_SUMMARY.reduce((s, r) => s + r.enquiryActual, 0) / DAILY_SUMMARY.reduce((s, r) => s + r.canopy, 0)),
    hot:             DAILY_SUMMARY.reduce((s, r) => s + r.hot, 0),
    trPlanned:       DAILY_SUMMARY.reduce((s, r) => s + r.trPlanned, 0),
    trActual:        DAILY_SUMMARY.reduce((s, r) => s + r.trActual, 0),
    trPerCanopy:     Math.round(DAILY_SUMMARY.reduce((s, r) => s + r.trActual, 0) / DAILY_SUMMARY.reduce((s, r) => s + r.canopy, 0)),
    bookToday:       DAILY_SUMMARY.reduce((s, r) => s + r.bookToday, 0),
    bookInHand:      DAILY_SUMMARY.reduce((s, r) => s + r.bookInHand, 0),
    retailToday:     DAILY_SUMMARY.reduce((s, r) => s + r.retailToday, 0),
    retailMtdAct:    DAILY_SUMMARY.reduce((s, r) => s + r.retailMtdAct, 0),
    retailMtd:       DAILY_SUMMARY.reduce((s, r) => s + r.retailMtd, 0),
    leads:           DAILY_SUMMARY.reduce((s, r) => s + r.leads, 0),
    punched:         DAILY_SUMMARY.reduce((s, r) => s + r.punched, 0),
    gap:             DAILY_SUMMARY.reduce((s, r) => s + r.gap, 0),
  }), []);

  // Lead report grand totals
  const lrTotals = useMemo(() => ({
    expectedLeads:   LEAD_REPORT.reduce((s, r) => s + r.expectedLeads, 0),
    walkinMtdA:      LEAD_REPORT.reduce((s, r) => s + r.walkinMtdA, 0),
    btlMtdA:         LEAD_REPORT.reduce((s, r) => s + r.btlMtdA, 0),
    referralMtdA:    LEAD_REPORT.reduce((s, r) => s + r.referralMtdA, 0),
    atlMtdA:         LEAD_REPORT.reduce((s, r) => s + r.atlMtdA, 0),
    digitalMtdA:     LEAD_REPORT.reduce((s, r) => s + r.digitalMtdA, 0),
    totalReceived:   LEAD_REPORT.reduce((s, r) => s + r.totalReceived, 0),
    variance:        LEAD_REPORT.reduce((s, r) => s + r.variance, 0),
    mtdRetailTarget: LEAD_REPORT.reduce((s, r) => s + r.mtdRetailTarget, 0),
    mtdRetailAch:    LEAD_REPORT.reduce((s, r) => s + r.mtdRetailAch, 0),
  }), []);

  if (loading) {
    return (
      <div className="dash-loading-screen">
        <div className="dash-spinner"/><p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="dash-root">

      {/* ── Quick actions ── */}
      <div className="dash-quick-actions">
        <button className="dash-action-card" onClick={() => navigate("/rsm-form")}>
          <span className="dash-action-icon">📋</span>
          <div><div className="dash-action-title">New Proposal</div><div className="dash-action-desc">Submit a BTL activity plan</div></div>
        </button>
        {isAdmin && (
          <button className="dash-action-card" onClick={() => navigate("/approver")}>
            <span className="dash-action-icon">✅</span>
            <div><div className="dash-action-title">Review Proposals</div><div className="dash-action-desc">Approve or reject pending plans</div></div>
          </button>
        )}
        <button className="dash-action-card dash-action-card--report" onClick={() => navigate("/reports")}>
          <span className="dash-action-icon">📊</span>
          <div><div className="dash-action-title">Download Report</div><div className="dash-action-desc">Excel &amp; PDF · by period, state, dealer</div></div>
        </button>
        {user?.role === "Admin" && (
          <button className="dash-action-card" onClick={() => navigate("/admin/users")}>
            <span className="dash-action-icon">👥</span>
            <div><div className="dash-action-title">Manage Users &amp; Activity</div><div className="dash-action-desc">Add Activity, edit roles and status</div></div>
          </button>
        )}
      </div>

      {loadingData ? (
        <div className="dash-loading-inline">
          <div className="dash-spinner dash-spinner--sm"/><span>Loading proposals…</span>
        </div>
      ) : dataError ? (
        <div className="dash-error-banner">⚠ {dataError}</div>
      ) : proposals.length === 0 ? (
        <div className="dash-empty">
          <span className="dash-empty-icon">📋</span>
          <p>No proposals yet.</p>
          <button className="dash-empty-btn" onClick={() => navigate("/rsm-form")}>
            Submit your first proposal
          </button>
        </div>
      ) : (
        <>
          {/* ══ KPI Cards ══════════════════════════════════════════════════ */}
          <div className="dash-kpi-grid">
            <KpiCard icon="📄" label="Total Proposals"
              value={String(stats.totalProposals)}
              sub={`${stats.dealerCount} dealers · ${stats.stateCount} states`}
              accent="blue" active={activeFilter === "All"}
              onClick={() => handleKpiClick("All")}/>
            <KpiCard icon="⏳" label="Pending Approval"
              value={String(stats.pendingCount)}
              sub={`Budget: ${inrCompact(stats.pendingBudget)}`}
              accent="amber" active={activeFilter === "Pending"}
              badge={stats.pendingCount > 0 ? "action needed" : undefined}
              onClick={() => { handleKpiClick("Pending"); if (isAdmin) navigate("/approver"); }}/>
            <KpiCard icon="✅" label="Approved"
              value={String(stats.approvedCount)}
              sub={`Budget: ${inrCompact(stats.approvedBudget)}`}
              accent="green" active={activeFilter === "Approved"}
              onClick={() => handleKpiClick("Approved")}/>
            <KpiCard icon="❌" label="Rejected"
              value={String(stats.rejectedCount)}
              sub={`${Math.round(stats.totalRetailTarget).toLocaleString("en-IN")} total units`}
              accent="red" active={activeFilter === "Rejected"}
              onClick={() => handleKpiClick("Rejected")}/>
            <KpiCard icon="💰" label="Total Budget"
              value={inrCompact(stats.totalBudget)}
              sub={`Avg CAC ₹${Math.round(stats.avgCac).toLocaleString("en-IN")}`}
              accent="purple" onClick={clearAllFilters}/>
            <KpiCard icon="📊" label="Avg CPL"
              value={`₹${Math.round(stats.avgCpl).toLocaleString("en-IN")}`}
              sub={`${stats.totalLeadTarget.toLocaleString("en-IN")} total leads`}
              accent="blue" onClick={clearAllFilters}/>
          </div>

          {/* ── POINT 4: Filter scope hint when month/state filter active ── */}
          {hasActiveFilter && (
            <div style={{
              background: "#eff6ff", border: "1px solid #bfdbfe",
              borderRadius: 8, padding: "8px 14px", fontSize: 12,
              color: "#1e40af", marginBottom: 4,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span>📊</span>
              <strong>KPI counts filtered:</strong>
              {stateFilter  !== "All" && <span>State: <b>{stateFilter}</b></span>}
              {monthFilter  !== "All" && <span>Month: <b>{monthFilter}</b></span>}
              {activeFilter !== "All" && <span>Status: <b>{activeFilter}</b></span>}
              <button
                style={{
                  marginLeft: "auto", background: "none", border: "none",
                  color: "#2563eb", cursor: "pointer", fontSize: 12, fontWeight: 600,
                }}
                onClick={clearAllFilters}>
                Show all ✕
              </button>
            </div>
          )}

          {/* ══ Report Tabs — Admin only ════════════════════════════════════ */}
          {isAdmin && (
            <div className="dash-report-tabs">
              {([
                { id: "overview",      label: "📋 BTL Overview",   desc: "Proposals, state & dealer summary" },
                { id: "daily-summary", label: "📅 Daily Activity", desc: "Today's canopy & activity sheet" },
                { id: "lead-report",   label: "🎯 Lead Report",    desc: "State-wise planned vs actual leads" },
              ] as { id: ReportTab; label: string; desc: string }[]).map(({ id, label, desc }) => (
                <button key={id}
                  className={`dash-report-tab${reportTab === id ? " dash-report-tab--active" : ""}`}
                  onClick={() => setReportTab(id)}>
                  <span className="dash-report-tab-label">{label}</span>
                  <span className="dash-report-tab-desc">{desc}</span>
                </button>
              ))}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: BTL OVERVIEW
          ══════════════════════════════════════════════════════════════ */}
          {(!isAdmin || reportTab === "overview") && (
            <>
              {/* Global filter bar */}
              <div className="dash-global-filter-bar">
                <div className="dash-global-filter-left">
                  <span className="dash-filter-label">Filters:</span>
                  <select className="dash-filter-select dash-filter-select--inline"
                    value={activeFilter}
                    onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}>
                    {["All","Pending","Approved","Rejected"].map((s) => (
                      <option key={s} value={s}>{s === "All" ? "All Statuses" : s}</option>
                    ))}
                  </select>
                  <select className="dash-filter-select dash-filter-select--inline"
                    value={stateFilter}
                    onChange={(e) => setStateFilter(e.target.value)}>
                    {states.map((s) => (
                      <option key={s} value={s}>{s === "All" ? "All States" : s}</option>
                    ))}
                  </select>
                  <select className="dash-filter-select dash-filter-select--inline"
                    value={monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value)}>
                    {months.map((m) => (
                      <option key={m} value={m}>{m === "All" ? "All Months" : m}</option>
                    ))}
                  </select>
                  {activeFilterCount > 0 && (
                    <span className="dash-active-filter-count">{activeFilterCount} active</span>
                  )}
                </div>
                {(activeFilterCount > 0 || sharedSearch) && (
                  <button className="dash-filter-clear-all" onClick={clearAllFilters}>✕ Clear all</button>
                )}
              </div>

              {activeFilterCount > 0 && (
                <div className="dash-active-pills">
                  {activeFilter !== "All" && (
                    <span className={`dash-pill dash-pill--${activeFilter.toLowerCase()}`}>
                      Status: {activeFilter}
                      <button onClick={() => setActiveFilter("All")}>✕</button>
                    </span>
                  )}
                  {stateFilter !== "All" && (
                    <span className="dash-pill dash-pill--state">
                      State: {stateFilter}
                      <button onClick={() => setStateFilter("All")}>✕</button>
                    </span>
                  )}
                  {monthFilter !== "All" && (
                    <span className="dash-pill dash-pill--month">
                      Month: {monthFilter}
                      <button onClick={() => setMonthFilter("All")}>✕</button>
                    </span>
                  )}
                </div>
              )}

              <div className="dash-shared-search-bar">
                <div className="dash-search-wrap dash-search-wrap--shared">
                  <span className="dash-search-icon">🔍</span>
                  <input className="dash-search-input" type="search"
                    placeholder="Search state, dealer, RSM, city…"
                    value={sharedSearch}
                    onChange={(e) => setSharedSearch(e.target.value)}/>
                  {sharedSearch && (
                    <button className="dash-search-clear" onClick={() => setSharedSearch("")}>✕</button>
                  )}
                </div>
                {searchResultLabel && (
                  <span className="dash-search-results-info">{searchResultLabel}</span>
                )}
              </div>

              {dlError && (
                <div className="dash-dl-error">
                  ⚠ {dlError}
                  <button onClick={() => setDlError(null)}>✕</button>
                </div>
              )}

              {/* ── State-wise table — POINT 7: Revision column ── */}
              {stateBreakdown.length > 0 && (
                <section className="dash-section">
                  <div className="dash-section-head">
                    <h2 className="dash-section-title">
                      State-wise Summary
                      <span className="dash-count-chip">{stateBreakdown.length}</span>
                    </h2>
                    <div className="dash-section-dl-group">
                      {stateFilter !== "All" && (
                        <span className="dash-section-filter-hint">
                          {stateFilter}{monthFilter !== "All" ? ` · ${monthFilter}` : ""}
                        </span>
                      )}
                      <button className="dash-dl-btn dash-dl-btn--excel"
                        onClick={() => handleDownload("excel")} disabled={downloading !== null}>
                        {downloading === "excel" ? <><span className="dash-dl-spinner"/>Generating…</> : <>⬇ Excel</>}
                      </button>
                      <button className="dash-dl-btn dash-dl-btn--pdf"
                        onClick={() => handleDownload("pdf")} disabled={downloading !== null}>
                        {downloading === "pdf" ? <><span className="dash-dl-spinner"/>Generating…</> : <>⬇ PDF</>}
                      </button>
                      <button className="dash-dl-btn dash-dl-btn--full" onClick={() => navigate("/reports")}>
                        Full Report ↗
                      </button>
                    </div>
                  </div>
                  <div className="dash-table-wrap dash-table-wrap--wide">
                    <table className="dash-table dash-table--summary">
                      <thead>
                        <tr className="dash-thead-group">
                          <th className="dash-th dash-th--state" rowSpan={2}>States</th>
                          <th className="dash-th dash-th--group dash-th--old" colSpan={4}>Eligible Old Dealer</th>
                          <th className="dash-th dash-th--group dash-th--new" colSpan={4}>Eligible New Dealer</th>
                          <th className="dash-th dash-th--group dash-th--non" colSpan={4}>Non Eligible Dealer</th>
                          <th className="dash-th dash-th--group dash-th--tot" colSpan={6}>Totals</th>
                          {/* POINT 7: Status group now has colSpan 4 (Pending/Approved/Rejected/Revision) */}
                          <th className="dash-th dash-th--group" colSpan={4}>Status</th>
                          <th className="dash-th" rowSpan={2}>Remarks</th>
                        </tr>
                        <tr className="dash-thead-sub">
                          <th className="dash-th dash-th--old dash-th--right">Retail Target</th>
                          <th className="dash-th dash-th--old dash-th--right">Count</th>
                          <th className="dash-th dash-th--old dash-th--right">Budget (₹)</th>
                          <th className="dash-th dash-th--old dash-th--right">CAC (₹)</th>
                          <th className="dash-th dash-th--new dash-th--right">Retail Target</th>
                          <th className="dash-th dash-th--new dash-th--right">Count</th>
                          <th className="dash-th dash-th--new dash-th--right">Budget (₹)</th>
                          <th className="dash-th dash-th--new dash-th--right">CAC (₹)</th>
                          <th className="dash-th dash-th--non dash-th--right">Retail Target</th>
                          <th className="dash-th dash-th--non dash-th--right">Count</th>
                          <th className="dash-th dash-th--non dash-th--right">Budget (₹)</th>
                          <th className="dash-th dash-th--non dash-th--right">CAC (₹)</th>
                          <th className="dash-th dash-th--tot dash-th--right">Dealers for BTL</th>
                          <th className="dash-th dash-th--tot dash-th--right">Total Budget (₹)</th>
                          <th className="dash-th dash-th--tot dash-th--right">Total Retail</th>
                          <th className="dash-th dash-th--tot dash-th--right">Total Lead</th>
                          <th className="dash-th dash-th--tot dash-th--right">Overall CAC</th>
                          <th className="dash-th dash-th--tot dash-th--right">Overall CPL</th>
                          {/* POINT 7: 4 status sub-headers */}
                          <th className="dash-th dash-th--right" style={{background:"#f59e0b22",color:"#92400e"}}>Pending</th>
                          <th className="dash-th dash-th--right" style={{background:"#16a34a22",color:"#14532d"}}>Approved</th>
                          <th className="dash-th dash-th--right" style={{background:"#dc262622",color:"#7f1d1d"}}>Rejected</th>
                          <th className="dash-th dash-th--right" style={{background:"#f59e0b33",color:"#78350f"}}>Revision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stateBreakdown.map((row, i) => (
                          <tr key={row.state} className={i % 2 === 0 ? "dash-row-even" : "dash-row-odd"}>
                            <td className="dash-td">
                              <span className={`dash-state-tag${sharedSearch && row.state.toLowerCase().includes(sharedSearch.toLowerCase()) ? " dash-state-tag--match" : ""}`}>
                                {row.state}
                              </span>
                            </td>
                            <td className="dash-td dash-td--right">{row.oldRetail > 0 ? row.oldRetail : <Dash/>}</td>
                            <td className="dash-td dash-td--right">{row.oldCount  > 0 ? row.oldCount  : <Dash/>}</td>
                            <td className="dash-td dash-td--right dash-td--mono">{row.oldBudget > 0 ? inr(row.oldBudget) : <Dash/>}</td>
                            <td className="dash-td dash-td--right dash-td--mono">{row.oldCac > 0 ? `₹${Math.round(row.oldCac).toLocaleString("en-IN")}` : <Dash/>}</td>
                            <td className="dash-td dash-td--right">{row.newRetail > 0 ? row.newRetail : <Dash/>}</td>
                            <td className="dash-td dash-td--right">{row.newCount  > 0 ? row.newCount  : <Dash/>}</td>
                            <td className="dash-td dash-td--right dash-td--mono">{row.newBudget > 0 ? inr(row.newBudget) : <Dash/>}</td>
                            <td className="dash-td dash-td--right dash-td--mono">{row.newCac > 0 ? `₹${Math.round(row.newCac).toLocaleString("en-IN")}` : <Dash/>}</td>
                            <td className="dash-td dash-td--right">{row.nonRetail > 0 ? row.nonRetail : <Dash/>}</td>
                            <td className="dash-td dash-td--right"
                              title={row.baplNonEligible > 0 ? `${row.baplNonEligible} non-eligible from BaplFinal DB` : ""}>
                              {row.nonCount > 0 ? <span className="dash-non-count">{row.nonCount}</span> : <Dash/>}
                            </td>
                            <td className="dash-td dash-td--right dash-td--mono">{row.nonBudget > 0 ? inr(row.nonBudget) : <Dash/>}</td>
                            <td className="dash-td dash-td--right dash-td--mono">{row.nonCac > 0 ? `₹${Math.round(row.nonCac).toLocaleString("en-IN")}` : <Dash/>}</td>
                            <td className="dash-td dash-td--right dash-td--bold">{row.totalDealers}</td>
                            <td className="dash-td dash-td--right dash-td--mono dash-td--bold">{inr(row.totalBudget)}</td>
                            <td className="dash-td dash-td--right dash-td--bold">{Math.round(row.totalRetail).toLocaleString("en-IN")}</td>
                            <td className="dash-td dash-td--right dash-td--bold">{Math.round(row.totalLead).toLocaleString("en-IN")}</td>
                            <td className="dash-td dash-td--right dash-td--mono dash-td--bold">
                              {row.overallCac > 0 ? `₹${Math.round(row.overallCac).toLocaleString("en-IN")}` : <Dash/>}
                            </td>
                            <td className="dash-td dash-td--right dash-td--mono dash-td--bold">
                              {row.overallCpl > 0 ? `₹${Math.round(row.overallCpl).toLocaleString("en-IN")}` : <Dash/>}
                            </td>
                            {/* POINT 7: status cells */}
                            <td className="dash-td dash-td--right">
                              {row.pending  > 0
                                ? <span className="dash-badge dash-badge--pending">{row.pending}</span>
                                : <span className="dash-muted">—</span>}
                            </td>
                            <td className="dash-td dash-td--right">
                              {row.approved > 0
                                ? <span className="dash-badge dash-badge--approved">{row.approved}</span>
                                : <span className="dash-muted">—</span>}
                            </td>
                            <td className="dash-td dash-td--right">
                              {row.rejected > 0
                                ? <span className="dash-badge dash-badge--rejected">{row.rejected}</span>
                                : <span className="dash-muted">—</span>}
                            </td>
                            {/* POINT 7: NEW revision column */}
                            <td className="dash-td dash-td--right">
                              {row.revision > 0
                                ? <span className="dash-badge dash-badge--revision">{row.revision}</span>
                                : <span className="dash-muted">—</span>}
                            </td>
                            <td className="dash-td dash-td--remarks">{row.remarks || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                      {stateGrandTotal && (
                        <tfoot>
                          <tr className="dash-grand-total">
                            <td className="dash-td dash-td--grand-label">Grand Totals</td>
                            <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.oldRetail.toLocaleString("en-IN")}</td>
                            <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.oldCount}</td>
                            <td className="dash-td dash-td--right dash-td--grand dash-td--mono">{inr(stateGrandTotal.oldBudget)}</td>
                            <td className="dash-td dash-td--right dash-td--grand dash-td--mono">
                              {stateGrandTotal.oldRetail > 0 ? `₹${Math.round(stateGrandTotal.oldBudget / stateGrandTotal.oldRetail).toLocaleString("en-IN")}` : "—"}
                            </td>
                            <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.newRetail.toLocaleString("en-IN")}</td>
                            <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.newCount}</td>
                            <td className="dash-td dash-td--right dash-td--grand dash-td--mono">{inr(stateGrandTotal.newBudget)}</td>
                            <td className="dash-td dash-td--right dash-td--grand dash-td--mono">
                              {stateGrandTotal.newRetail > 0 ? `₹${Math.round(stateGrandTotal.newBudget / stateGrandTotal.newRetail).toLocaleString("en-IN")}` : "—"}
                            </td>
                            <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.nonRetail.toLocaleString("en-IN")}</td>
                            <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.nonCount}</td>
                            <td className="dash-td dash-td--right dash-td--grand dash-td--mono">{inr(stateGrandTotal.nonBudget)}</td>
                            <td className="dash-td dash-td--right dash-td--grand dash-td--mono">
                              {stateGrandTotal.nonRetail > 0 ? `₹${Math.round(stateGrandTotal.nonBudget / stateGrandTotal.nonRetail).toLocaleString("en-IN")}` : "—"}
                            </td>
                            <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.totalDealers}</td>
                            <td className="dash-td dash-td--right dash-td--grand dash-td--mono">{inr(stateGrandTotal.totalBudget)}</td>
                            <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.totalRetail.toLocaleString("en-IN")}</td>
                            <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.totalLead.toLocaleString("en-IN")}</td>
                            <td className="dash-td dash-td--right dash-td--grand dash-td--mono">
                              {stateGrandTotal.totalRetail > 0 ? `₹${Math.round(stateGrandTotal.totalBudget / stateGrandTotal.totalRetail).toLocaleString("en-IN")}` : "—"}
                            </td>
                            <td className="dash-td dash-td--right dash-td--grand dash-td--mono">
                              {stateGrandTotal.totalLead > 0 ? `₹${Math.round(stateGrandTotal.totalBudget / stateGrandTotal.totalLead).toLocaleString("en-IN")}` : "—"}
                            </td>
                            {/* POINT 7: 5 empty cells = 4 status + 1 remarks */}
                            <td className="dash-td" colSpan={5}/>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </section>
              )}

              {/* ── Dealer-wise table ── */}
              <section className="dash-section">
                <div className="dash-section-head">
                  <h2 className="dash-section-title">
                    Dealer-wise Data
                    <span className="dash-count-chip">{dealerRows.length}</span>
                  </h2>
                  <div className="dash-section-dl-group">
                    <button className="dash-dl-btn dash-dl-btn--excel"
                      onClick={() => handleDownload("excel")} disabled={downloading !== null}>
                      {downloading === "excel" ? <><span className="dash-dl-spinner"/>Generating…</> : <>⬇ Excel</>}
                    </button>
                    <button className="dash-dl-btn dash-dl-btn--pdf"
                      onClick={() => handleDownload("pdf")} disabled={downloading !== null}>
                      {downloading === "pdf" ? <><span className="dash-dl-spinner"/>Generating…</> : <>⬇ PDF</>}
                    </button>
                  </div>
                </div>
                {dealerRows.length === 0 ? (
                  <div className="dash-no-results">
                    <span>🔍</span>
                    <p>No dealers match your filters.</p>
                    <button className="dash-filter-clear-all" onClick={clearAllFilters}>Clear all filters</button>
                  </div>
                ) : (
                  <div className="dash-table-wrap">
                    <table className="dash-table dash-table--dealer">
                      <thead>
                        <tr>
                          <th className="dash-th" style={{textAlign:"left"}}>State</th>
                          <th className="dash-th" style={{textAlign:"left"}}>Dealer Name</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Month Target</th>
                          <th className="dash-th" style={{textAlign:"left"}}>Category</th>
                          <th className="dash-th" style={{textAlign:"left"}}>BTL Category</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Activities</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Retail Target</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Lead Target</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Budget for BTL (₹)</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Pending</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Approved</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Rejected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dealerRows.map((row, i) => {
                          const el     = (row.eligibility ?? "").toLowerCase();
                          const isNon  = el.includes("not") || el.includes("non");
                          const isNew  = row.type?.toLowerCase() === "new";
                          const catBase = isNon ? "Non Eligible" : "BTL Budget Eligible";
                          const cat    = isNon
                            ? "Dealers Non Eligible for BTL"
                            : isNew
                            ? "Budget taken for BTL (New)"
                            : "Budget taken for BTL (Old+New+Special Approval)";
                          const btlBudget   = row.eligibleOldBudget + row.eligibleNewBudget;
                          const q           = sharedSearch.toLowerCase().trim();
                          const dealerMatch = q && row.dealerName.toLowerCase().includes(q);
                          return (
                            <tr key={`${row.dealerName}__${row.state}`}
                              className={i % 2 === 0 ? "dash-row-even" : "dash-row-odd"}>
                              <td className="dash-td"><span className="dash-state-tag">{row.state}</span></td>
                              <td className="dash-td">
                                <span className={`dash-dealer-name${dealerMatch ? " dash-dealer-name--match" : ""}`}>
                                  {row.dealerName}
                                </span>
                              </td>
                              <td className="dash-td" style={{textAlign:"center"}}>{Math.round(row.monthTarget).toLocaleString("en-IN")}</td>
                              <td className="dash-td">
                                <span className={`dash-cat-tag dash-cat-tag--${isNon ? "non" : "eligible"}`}>{catBase}</span>
                              </td>
                              <td className="dash-td dash-td--category">
                                {row.activityNames && row.activityNames.size > 0
                                  ? Array.from(row.activityNames).join(", ")
                                  : cat}
                              </td>
                              <td className="dash-td" style={{textAlign:"center"}}>{row.activities}</td>
                              <td className="dash-td" style={{textAlign:"center"}}>{Math.round(row.retailTarget).toLocaleString("en-IN")}</td>
                              <td className="dash-td" style={{textAlign:"center"}}>{Math.round(row.leadTarget).toLocaleString("en-IN")}</td>
                              <td className="dash-td dash-td--mono" style={{textAlign:"center"}}>
                                {btlBudget > 0 ? inr(btlBudget) : <Dash/>}
                              </td>
                              <td className="dash-td" style={{textAlign:"center"}}>
                                {row.pending  > 0 ? <span className="dash-badge dash-badge--pending">{row.pending}</span>   : <span className="dash-muted">—</span>}
                              </td>
                              <td className="dash-td" style={{textAlign:"center"}}>
                                {row.approved > 0 ? <span className="dash-badge dash-badge--approved">{row.approved}</span> : <span className="dash-muted">—</span>}
                              </td>
                              <td className="dash-td" style={{textAlign:"center"}}>
                                {row.rejected > 0 ? <span className="dash-badge dash-badge--rejected">{row.rejected}</span> : <span className="dash-muted">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: DAILY ACTIVITY SUMMARY
          ══════════════════════════════════════════════════════════════ */}
          {isAdmin && reportTab === "daily-summary" && (
            <section className="dash-section">
              <div className="dash-section-head">
                <div>
                  <h2 className="dash-section-title" style={{fontSize:16}}>
                    📅 Daily Activity Sheet Summary
                    <span style={{fontSize:12,fontWeight:400,color:"#64748b",marginLeft:10}}>03 July 2026</span>
                  </h2>
                  <p style={{margin:"2px 0 0",fontSize:11,color:"#94a3b8"}}>
                    Click any dealer row to view their full daily activity sheet ↗
                  </p>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <span style={{fontSize:11,background:"#fef3c7",color:"#92400e",padding:"3px 10px",borderRadius:20,fontWeight:700}}>
                    🔴 Mock data — connect to live API
                  </span>
                  <button
                    onClick={()=>printSection("daily-summary-table","Daily Activity Summary")}
                    style={{background:"#dc2626",color:"#fff",border:"none",borderRadius:6,
                      padding:"6px 14px",fontSize:11,fontWeight:700,cursor:"pointer",
                      display:"flex",alignItems:"center",gap:5}}>
                    ⬇ PDF
                  </button>
                </div>
              </div>
              <div className="dash-table-wrap dash-table-wrap--wide">
                <table id="daily-summary-table" className="dash-table" style={{minWidth:1500}}>
                  <thead>
                    <tr style={{background:"#0a2540"}}>
                      <th className="dash-th" rowSpan={2} style={{minWidth:32}}>#</th>
                      <th className="dash-th" rowSpan={2} style={{minWidth:120,textAlign:"left"}}>Dealer</th>
                      <th className="dash-th" rowSpan={2} style={{minWidth:90,textAlign:"left"}}>Location</th>
                      <th className="dash-th" rowSpan={2} style={{width:45}}>State</th>
                      <th className="dash-th" rowSpan={2} style={{width:55}}>Zone</th>
                      <th className="dash-th" rowSpan={2} style={{minWidth:90,textAlign:"left"}}>BG Member</th>
                      <th className="dash-th" rowSpan={2} style={{width:55}}>Canopy</th>
                      <th className="dash-th" colSpan={4} style={{textAlign:"center",background:"#1e3a5f",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>Enquiry</th>
                      <th className="dash-th" colSpan={3} style={{textAlign:"center",background:"#166534",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>Test Rides</th>
                      <th className="dash-th" colSpan={2} style={{textAlign:"center",background:"#7c3aed",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>Bookings</th>
                      <th className="dash-th" colSpan={4} style={{textAlign:"center",background:"#b45309",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>Retail</th>
                      <th className="dash-th" rowSpan={2} style={{width:55}}>Activity Day</th>
                      <th className="dash-th" rowSpan={2} style={{width:65}}>Closing Stock</th>
                      <th className="dash-th" colSpan={4} style={{textAlign:"center",background:"#1e40af",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>LMS / Retail</th>
                    </tr>
                    <tr style={{background:"#0f172a"}}>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#1e3a5f"}}>Planned</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#1e3a5f"}}>Actual</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#1e3a5f"}}>Per Canopy</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#1e3a5f"}}>Hot</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#166534"}}>Planned</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#166534"}}>Actual</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#166534"}}>Per Canopy</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#7c3aed"}}>Today</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#7c3aed"}}>In Hand</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#b45309"}}>Today</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#b45309"}}>MTD (Act.)</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#b45309"}}>MTD</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#b45309"}}>Rate/Canopy</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#1e40af"}}>Leads</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#1e40af"}}>Punched</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#1e40af"}}>Gap</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#1e40af"}}>Conv%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DAILY_SUMMARY.map((row, i) => {
                      const enqColor  = cellColor(row.enquiryActual, row.enquiryPlanned);
                      const trColor   = cellColor(row.trActual, row.trPlanned);
                      const rateColor = row.retailRatePerCanopy >= 1 ? "#d1fae5" : row.retailRatePerCanopy >= 0.5 ? "#fef3c7" : "#fee2e2";
                      return (
                        <tr key={row.sr} className={i % 2 === 0 ? "dash-row-even" : "dash-row-odd"}
                          style={{cursor:"pointer"}}
                          onClick={() => { setSelectedDealerDaily(row); setReportTab("dealer-daily"); }}>
                          <td className="dash-td" style={{textAlign:"center",color:"#64748b",fontSize:11}}>{row.sr}</td>
                          <td className="dash-td" style={{fontWeight:700,color:"#0a2540"}}>{row.dealer}</td>
                          <td className="dash-td" style={{fontSize:12,color:"#475569"}}>{row.location}</td>
                          <td className="dash-td" style={{textAlign:"center"}}><span className="dash-state-tag">{row.state}</span></td>
                          <td className="dash-td" style={{textAlign:"center",fontSize:11,color:"#64748b"}}>{row.zone}</td>
                          <td className="dash-td" style={{fontSize:12,fontWeight:600,color:"#374151"}}>{row.bgMember}</td>
                          <td className="dash-td" style={{textAlign:"center",fontWeight:700}}>{row.canopy}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12}}>{row.enquiryPlanned}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,background:enqColor}}>{row.enquiryActual}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,background:enqColor}}>{row.perCanopy}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12}}>{row.hot}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12}}>{row.trPlanned}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,background:trColor}}>{row.trActual}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,background:trColor}}>{row.trPerCanopy}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,color:"#7c3aed"}}>{row.bookToday}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12,color:"#7c3aed"}}>{row.bookInHand}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,color:row.retailToday>0?"#166534":"#64748b"}}>{row.retailToday}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12}}>{row.retailMtdAct}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700}}>{row.retailMtd}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,background:rateColor}}>{row.retailRatePerCanopy.toFixed(1)}</td>
                          <td className="dash-td" style={{textAlign:"center",fontSize:11,color:"#64748b"}}>{row.activityDay}</td>
                          <td className="dash-td" style={{textAlign:"center",fontSize:12}}>{row.closingStock}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12}}>{row.leads}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12}}>{row.punched}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12,color:row.gap>50?"#dc2626":"#374151"}}>{row.gap}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,background:achColor(row.convPct)}}>{row.convPct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{background:"#fef9c3",borderTop:"2px solid #fde68a"}}>
                      <td className="dash-td" colSpan={6} style={{fontWeight:800,fontSize:12,color:"#92400e"}}>Total ({DAILY_SUMMARY.length})</td>
                      <td className="dash-td" style={{textAlign:"center",fontWeight:800}}>{dsTotals.canopy}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:700}}>{dsTotals.enquiryPlanned}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{dsTotals.enquiryActual}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{dsTotals.perCanopy}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:700}}>{dsTotals.hot}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:700}}>{dsTotals.trPlanned}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{dsTotals.trActual}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{dsTotals.trPerCanopy}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{dsTotals.bookToday}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:700}}>{dsTotals.bookInHand}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{dsTotals.retailToday}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:700}}>{dsTotals.retailMtdAct}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{dsTotals.retailMtd}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>
                        {(dsTotals.retailMtd / dsTotals.canopy).toFixed(1)}
                      </td>
                      <td className="dash-td" colSpan={2}/>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{dsTotals.leads}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:700}}>{dsTotals.punched}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{dsTotals.gap}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>
                        {Math.round(dsTotals.retailMtd / dsTotals.leads * 100)}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: LEAD REPORT
          ══════════════════════════════════════════════════════════════ */}
          {isAdmin && reportTab === "lead-report" && (
            <section className="dash-section">
              <div className="dash-section-head">
                <div>
                  <h2 className="dash-section-title" style={{fontSize:16}}>
                    🎯 Lead Report
                    <span style={{fontSize:12,fontWeight:400,color:"#64748b",marginLeft:10}}>Statewise Planned Leads vs Actual · 03 July 2026 EoD</span>
                  </h2>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <span style={{fontSize:11,background:"#fef3c7",color:"#92400e",padding:"3px 10px",borderRadius:20,fontWeight:700}}>
                    🔴 Mock data — connect to live API
                  </span>
                  <button
                    onClick={()=>printSection("lead-report-table","Lead Report — Statewise")}
                    style={{background:"#dc2626",color:"#fff",border:"none",borderRadius:6,
                      padding:"6px 14px",fontSize:11,fontWeight:700,cursor:"pointer",
                      display:"flex",alignItems:"center",gap:5}}>
                    ⬇ PDF
                  </button>
                </div>
              </div>
              <div className="dash-table-wrap dash-table-wrap--wide">
                <table id="lead-report-table" className="dash-table" style={{minWidth:1600}}>
                  <thead>
                    <tr style={{background:"#0a2540"}}>
                      <th className="dash-th" rowSpan={3} style={{minWidth:120,textAlign:"left"}}>State</th>
                      <th className="dash-th" rowSpan={3} style={{width:70}}>Expected Leads</th>
                      <th className="dash-th" colSpan={9} style={{textAlign:"center",background:"#1e3a5f",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>Lead Status</th>
                      <th className="dash-th" rowSpan={3} style={{width:65}}>Total Leads Received</th>
                      <th className="dash-th" rowSpan={3} style={{width:65}}>Leads Variance</th>
                      <th className="dash-th" rowSpan={3} style={{width:65,background:"#fef3c7",color:"#92400e"}}>Leads Ach.%</th>
                      <th className="dash-th" rowSpan={3} style={{width:65}}>Jul 26 Retail Target</th>
                      <th className="dash-th" rowSpan={3} style={{width:65}}>MTD Retail Target</th>
                      <th className="dash-th" rowSpan={3} style={{width:65}}>MTD Retail Achieved</th>
                      <th className="dash-th" rowSpan={3} style={{width:70,background:"#166534"}}>MTD Retail Ach.%</th>
                      <th className="dash-th" rowSpan={3} style={{width:65}}>Retails / Enquiries%</th>
                    </tr>
                    <tr style={{background:"#0f172a"}}>
                      <th className="dash-th" colSpan={3} style={{textAlign:"center",background:"#1e3a5f",fontSize:9}}>Walk-in</th>
                      <th className="dash-th" colSpan={3} style={{textAlign:"center",background:"#166534",fontSize:9}}>BTL</th>
                      <th className="dash-th" colSpan={3} style={{textAlign:"center",background:"#7c3aed",fontSize:9}}>Digital</th>
                    </tr>
                    <tr style={{background:"#1e293b"}}>
                      {["Target","MTD T","MTD A","Target","MTD T","MTD A","Target","MTD T","MTD A"].map((h, i) => (
                        <th key={i} className="dash-th dash-th--right"
                          style={{fontSize:9,background:i<3?"#1e3a5f":i<6?"#166534":"#7c3aed"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {LEAD_REPORT.map((row, i) => {
                      const retailAchColor = achColor(row.mtdRetailAchPct);
                      return (
                        <tr key={row.state} className={i % 2 === 0 ? "dash-row-even" : "dash-row-odd"}>
                          <td className="dash-td" style={{fontWeight:700,color:"#0a2540"}}>{row.state}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12}}>{row.expectedLeads.toLocaleString("en-IN")}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:11,color:"#475569"}}>{row.walkinTarget}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:11,color:"#475569"}}>{row.walkinMtdT}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,background:cellColor(row.walkinMtdA,row.walkinMtdT)}}>{row.walkinMtdA}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:11,color:"#475569"}}>{row.btlTarget.toLocaleString("en-IN")}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:11,color:"#475569"}}>{row.btlMtdT}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,background:cellColor(row.btlMtdA,row.btlMtdT)}}>{row.btlMtdA}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:11,color:"#475569"}}>{row.digitalTarget.toLocaleString("en-IN")}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:11,color:"#475569"}}>{row.digitalMtdT}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,background:cellColor(row.digitalMtdA,row.digitalMtdT)}}>{row.digitalMtdA}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700}}>{row.totalReceived}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,color:row.variance<0?"#dc2626":"#166534"}}>{row.variance.toLocaleString("en-IN")}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:800,background:achColor(row.achPct)}}>{row.achPct}%</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12}}>{row.jul26RetailTarget}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12}}>{row.mtdRetailTarget}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700}}>{row.mtdRetailAch}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:800,background:retailAchColor}}>{row.mtdRetailAchPct}%</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12,color:"#475569"}}>{row.retailEnqPct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{background:"#fef9c3",borderTop:"2px solid #fde68a"}}>
                      <td className="dash-td" style={{fontWeight:800,color:"#92400e",fontSize:12}}>Grand Total</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{lrTotals.expectedLeads.toLocaleString("en-IN")}</td>
                      <td className="dash-td" colSpan={2}/>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{lrTotals.walkinMtdA}</td>
                      <td className="dash-td" colSpan={2}/>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{lrTotals.btlMtdA}</td>
                      <td className="dash-td" colSpan={2}/>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{lrTotals.digitalMtdA}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{lrTotals.totalReceived}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800,color:"#dc2626"}}>{lrTotals.variance.toLocaleString("en-IN")}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800,background:achColor(Math.round(lrTotals.totalReceived/lrTotals.expectedLeads*100))}}>
                        {Math.round(lrTotals.totalReceived/lrTotals.expectedLeads*100)}%
                      </td>
                      <td className="dash-td"/>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{lrTotals.mtdRetailTarget}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>{lrTotals.mtdRetailAch}</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800,background:achColor(Math.round(lrTotals.mtdRetailAch/lrTotals.mtdRetailTarget*100))}}>
                        {Math.round(lrTotals.mtdRetailAch/lrTotals.mtdRetailTarget*100)}%
                      </td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>
                        {Math.round(lrTotals.mtdRetailAch/lrTotals.totalReceived*100)}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: DEALER DAILY SHEET — drill-down
          ══════════════════════════════════════════════════════════════ */}
          {isAdmin && reportTab === "dealer-daily" && selectedDealerDaily && (
            <section className="dash-section">
              <div className="dash-section-head">
                <div>
                  <button onClick={() => setReportTab("daily-summary")}
                    style={{background:"none",border:"none",color:"#2563eb",cursor:"pointer",fontSize:13,fontWeight:600,padding:"0 0 6px",display:"flex",alignItems:"center",gap:5}}>
                    ← Back to Daily Summary
                  </button>
                  <h2 className="dash-section-title" style={{fontSize:16}}>
                    🏪 {selectedDealerDaily.dealer} — {selectedDealerDaily.location}
                    <span style={{fontSize:12,fontWeight:400,color:"#64748b",marginLeft:10}}>July 2026 · BG Team: {selectedDealerDaily.bgMember}</span>
                  </h2>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:11,background:"#fef3c7",color:"#92400e",padding:"3px 10px",borderRadius:20,fontWeight:700}}>🔴 Mock data</span>
                  <button
                    onClick={()=>printSection("dealer-daily-table",`${selectedDealerDaily.dealer} — ${selectedDealerDaily.location} Daily Sheet`)}
                    style={{background:"#dc2626",color:"#fff",border:"none",borderRadius:6,
                      padding:"6px 14px",fontSize:11,fontWeight:700,cursor:"pointer",
                      display:"flex",alignItems:"center",gap:5}}>
                    ⬇ PDF
                  </button>
                </div>
              </div>
              <div className="dash-table-wrap dash-table-wrap--wide">
                <table id="dealer-daily-table" className="dash-table" style={{minWidth:1100}}>
                  <thead>
                    <tr style={{background:"#0a2540"}}>
                      <th className="dash-th" rowSpan={2} style={{minWidth:90,textAlign:"left"}}>Date</th>
                      <th className="dash-th" rowSpan={2} style={{width:70}}>Opening Stock</th>
                      <th className="dash-th" rowSpan={2} style={{width:65}}>Canopy</th>
                      <th className="dash-th" colSpan={7} style={{textAlign:"center",background:"#1e3a5f",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>Enquiry</th>
                      <th className="dash-th" colSpan={2} style={{textAlign:"center",background:"#166534",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>Test Drive</th>
                      <th className="dash-th" colSpan={2} style={{textAlign:"center",background:"#7c3aed",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>Booking · BG-{selectedDealerDaily.bgMember}</th>
                      <th className="dash-th" rowSpan={2} style={{width:65,background:"#b45309"}}>Retail</th>
                      <th className="dash-th" rowSpan={2} style={{width:65,background:"#b45309"}}>MTD Retail</th>
                    </tr>
                    <tr style={{background:"#0f172a"}}>
                      {["Canopy","Planned","Actual","Walk in","In LMS","Gap","Hot","Revised Hot"].map((h, i) => (
                        <th key={i} className="dash-th dash-th--right" style={{fontSize:9,background:"#1e3a5f"}}>{h}</th>
                      ))}
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#166534"}}>Planned</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#166534"}}>Actual</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#7c3aed"}}>Today</th>
                      <th className="dash-th dash-th--right" style={{fontSize:9,background:"#7c3aed"}}>In hand</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DEALER_DAILY.map((row, i) => {
                      const hasData  = row.enquiryActual !== undefined;
                      const enqColor = hasData ? cellColor(row.enquiryActual ?? 0, row.enquiryPlanned) : "";
                      return (
                        <tr key={row.date} className={i % 2 === 0 ? "dash-row-even" : "dash-row-odd"}>
                          <td className="dash-td" style={{fontSize:12,fontWeight:600,color:"#374151"}}>{row.date}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12,color:"#64748b"}}>{row.openingStock ?? ""}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700}}>{row.canopy ?? ""}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12,color:"#64748b"}}>{row.canopy ?? ""}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12}}>{row.enquiryPlanned || ""}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,background:enqColor}}>{row.enquiryActual ?? ""}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12,color:"#475569"}}>{row.walkIn ?? ""}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12,color:"#475569"}}>{row.inLms ?? ""}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12,color:row.gap !== undefined && row.gap < 0 ? "#dc2626" : "#166534",fontWeight:700}}>{row.gap ?? ""}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12}}>{row.hot ?? ""}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12}}>{row.revisedHot ?? ""}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12}}>{row.trPlanned || ""}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,background:hasData?cellColor(row.trActual??0,row.trPlanned):""}}>{row.trActual ?? ""}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,color:"#7c3aed"}}>{row.bookToday ?? ""}</td>
                          <td className="dash-td dash-td--right" style={{fontSize:12,color:"#7c3aed"}}>{row.bookInHand ?? ""}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700,color:row.retail&&row.retail>0?"#166534":"inherit"}}>{row.retail ?? ""}</td>
                          <td className="dash-td dash-td--right" style={{fontWeight:700}}>{row.mtdRetail ?? ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{background:"#fef9c3",borderTop:"2px solid #fde68a"}}>
                      <td className="dash-td" colSpan={2} style={{fontWeight:800,fontSize:12,color:"#92400e"}}>Total</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>5</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>5</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>175</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>154</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>14</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>99</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800,color:"#dc2626"}}>-55</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>14</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>8</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>149</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800}}>105</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800,color:"#7c3aed"}}>6</td>
                      <td className="dash-td dash-td--right" style={{color:"#7c3aed"}}>0</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800,color:"#166534"}}>6</td>
                      <td className="dash-td"/>
                    </tr>
                    <tr style={{background:"#f0fdf4",borderTop:"1px solid #bbf7d0"}}>
                      <td className="dash-td" colSpan={2} style={{fontWeight:600,fontSize:11,color:"#166534"}}>Avg Per Canopy</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:700}}>1</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:700}}>1</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:700}}>35</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800,background:"#fef3c7"}}>31</td>
                      <td className="dash-td dash-td--right">3</td>
                      <td className="dash-td"/>
                      <td className="dash-td"/>
                      <td className="dash-td dash-td--right">3</td>
                      <td className="dash-td dash-td--right">2</td>
                      <td className="dash-td dash-td--right">30</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:800,background:"#fef3c7"}}>21</td>
                      <td className="dash-td dash-td--right" style={{fontWeight:700}}>1.2</td>
                      <td className="dash-td"/>
                      <td className="dash-td dash-td--right" style={{fontWeight:800,background:"#fef3c7"}}>1.2</td>
                      <td className="dash-td"/>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function KpiCard({
  icon, label, value, sub, accent, active, onClick, badge,
}: {
  icon: string; label: string; value: string; sub: string;
  accent: "blue" | "amber" | "green" | "red" | "purple";
  active?: boolean; onClick: () => void; badge?: string;
}) {
  return (
    <button type="button"
      className={[
        "dash-kpi-card", "dash-kpi-card--clickable",
        `dash-kpi-card--${accent}`,
        active ? "dash-kpi-card--active" : "",
      ].filter(Boolean).join(" ")}
      onClick={onClick}>
      {badge && <span className="dash-kpi-badge">{badge}</span>}
      <div className="dash-kpi-icon">{icon}</div>
      <div className="dash-kpi-body">
        <div className="dash-kpi-label">{label}</div>
        <div className="dash-kpi-value">{value}</div>
        <div className="dash-kpi-sub">{sub}</div>
      </div>
      {active && <div className="dash-kpi-active-dot"/>}
    </button>
  );
}

function Dash() {
  return <span className="dash-muted">0</span>;
}