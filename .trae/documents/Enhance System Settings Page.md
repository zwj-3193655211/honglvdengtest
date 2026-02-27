I will revamp the **System Settings Page** to ensure it only displays active, functional parameters, removing unused legacy fields and adding missing controls for simulation and AI.

**Planned Changes to `src/pages/Settings.tsx`:**

1.  **Remove Unused Fields** (to prevent confusion):
    *   Remove **Detection Settings** section (Detection Radius, Update Interval) - *Not currently used by the backend*.
    *   Remove **Min Cycle Length** - *Backend only uses Max Cycle Length*.
    *   Remove **Emergency Priority** - *Not actively enforcing logic in the current scheduler*.

2.  **Add Missing "Simulation Controls"**:
    *   Add a new section for **Traffic Flow Simulation** (linked to `intersection_params`):
        *   **Arrival Rate Sliders**: Control how fast cars arrive (Straight/Left multipliers).
        *   **Release Rate Sliders**: Control how fast cars leave during green lights (Straight/Left multipliers).
    *   *Benefit*: These directly control the `virtualFlowGenerator`, allowing you to simulate "Peak" or "Off-Peak" manually as requested.

3.  **Add "AI Management" Section**:
    *   Add a dedicated toggle for **AI Traffic Advisor** (syncs with `api/settings/ai-mode`).
    *   Display current AI status clearly.

4.  **Refine "Rule-Based Parameters"**:
    *   Keep the existing useful fields: `Low Flow Window`, `Threshold`, `Min Green Floor`, `Max Cycle Length`, `Yellow Duration`.

This cleanup ensures that **every knob and dial on the settings page has a real, observable effect** on the system.