import { createContext } from "react";
import type { UnitSystem } from "@/lib/units";

/** The active project's unit, so deeply nested inputs can format and parse without prop drilling. */
export const UnitContext = createContext<UnitSystem>("ft");
