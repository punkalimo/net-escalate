import { useEffect, useMemo, useState } from "react";
import {
  Network, RefreshCw, X, ZoomIn, ZoomOut, Search, Router, Server, Shield,
  Monitor, Cable, Route, ScanLine, Gauge, CircleDot, Activity, Clock3
} from "lucide-react";
import { discoverTopology, discoverDevicePath, getDevices } from "../services/api";
