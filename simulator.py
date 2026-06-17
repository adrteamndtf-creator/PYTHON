#!/usr/bin/env python3
"""
RadSIM NDT - Solid Rocket Motor Monte Carlo Radiography Simulator (Python Port)

This script provides a high-performance Python version of the simulation engine.
It uses NumPy for vectorized math, SciPy/OpenCV for fast spatial blurs, and Matplotlib
to render the results.

Requirements:
    pip install numpy scipy matplotlib

Usage:
    python simulator.py --material steel --thickness 120 --energy 6MeV --output radiograph.png
"""

import os
import argparse
import math
import numpy as np
import matplotlib.pyplot as plt

# Optional OpenCV support for even faster blurs
try:
    import cv2
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False

# SciPy dependency removed to increase portability

# =====================================================================
# Physics Constants and Presets
# =====================================================================
MATERIAL_PRESETS = {
    "propellant": {"name": "HTPB Propellant", "density": 1.75, "Zeff": 7.4},
    "steel":      {"name": "Carbon Steel",    "density": 7.85, "Zeff": 26.0},
    "aluminum":   {"name": "Aluminum (6061)", "density": 2.70, "Zeff": 13.0},
    "cfrp":       {"name": "CFRP (Carbon)",   "density": 1.60, "Zeff": 6.0},
    "lead":       {"name": "Lead (Shielding)", "density": 11.34, "Zeff": 82.0},
    "titanium":   {"name": "Titanium",        "density": 4.51, "Zeff": 22.0},
    "copper":     {"name": "Copper",          "density": 8.96, "Zeff": 29.0},
    "stainless":  {"name": "Stainless Steel", "density": 7.95, "Zeff": 26.0},
    "magnesium":  {"name": "Magnesium",        "density": 1.74, "Zeff": 12.0},
    "nickel":     {"name": "Nickel",           "density": 8.90, "Zeff": 28.0},
    "brass":      {"name": "Brass",            "density": 8.50, "Zeff": 30.0}
}

MACHINE_PRESETS = {
    "xray450": {
        "name": "450 keV X-Ray System",
        "maxEnergy": 0.450,
        "effEnergy": 0.200,
        "sourceSizes": [0.4, 1.0, 3.0],
        "maxmA": 20.0,
        "doseRate1m": 120.0,
        "portability": "Semi-portable / Bunker"
    },
    "linac6": {
        "name": "6 MeV LINAC",
        "maxEnergy": 6.0,
        "effEnergy": 2.0,
        "sourceSizes": [1.0, 2.0],
        "maxmA": 0.1,
        "doseRate1m": 800.0,
        "portability": "Fixed Bunker"
    },
    "linac9": {
        "name": "9 MeV LINAC",
        "maxEnergy": 9.0,
        "effEnergy": 3.0,
        "sourceSizes": [1.5, 2.5],
        "maxmA": 0.15,
        "doseRate1m": 3000.0,
        "portability": "Fixed Bunker"
    }
}

# =====================================================================
# Physics Calculations
# =====================================================================
def get_mass_attenuation_coeff(energy_eff, z_eff):
    """
    Calculates mass attenuation coefficient (cm²/g) using semi-empirical physics formulas.
    """
    # 1. Photoelectric: Z^4 / E^3.2 (dominant at low energy and high-Z)
    photoelectric = 1.5e-9 * (z_eff ** 4.0) / (energy_eff ** 3.2)

    # 2. Compton: Klein-Nishina approximation
    alpha = energy_eff / 0.511
    compton = 0.40 * (z_eff / 55.8) * (1.0 / (1.0 + 0.4 * alpha))

    # 3. Rayleigh: Z^3 / E^3 (coherent scattering)
    rayleigh = 1.0e-9 * (z_eff ** 3.0) / (energy_eff ** 3.0)

    # 4. Pair Production: threshold at 1.022 MeV
    pair_production = 0.0
    if energy_eff > 1.022:
        pair_production = 1.2e-5 * (z_eff ** 2.0) * math.log(energy_eff / 1.022)

    return photoelectric + compton + rayleigh + pair_production


def calculate_attenuation(material, thickness_mm, energy_eff, filter_preset=None, filter_thickness_mm=0.0):
    """
    Computes transmission ratios, buildup factor, HVL, TVL, and scatter-to-primary ratio.
    """
    if isinstance(material, str):
        preset = MATERIAL_PRESETS.get(material.lower(), {"density": 1.0, "Zeff": 7.0})
        density = preset["density"]
        z_eff = preset["Zeff"]
    else:
        density = material.get("density", 1.0)
        z_eff = material.get("Zeff", 7.0)

    x = thickness_mm / 10.0  # mm to cm

    mass_mu = get_mass_attenuation_coeff(energy_eff, z_eff)
    mu = mass_mu * density

    # Spectral filter calculation
    filter_trans = 1.0
    if filter_preset and filter_thickness_mm > 0:
        filt = MATERIAL_PRESETS.get(filter_preset.lower())
        if filt:
            filt_x = filter_thickness_mm / 10.0
            filt_mass_mu = get_mass_attenuation_coeff(energy_eff, filt["Zeff"])
            filter_trans = math.exp(-filt_mass_mu * filt["density"] * filt_x)

    hvl = (math.log(2) / mu) * 10.0 if mu > 0 else 9999.0
    tvl = (math.log(10) / mu) * 10.0 if mu > 0 else 9999.0

    k_scatter = 0.08 if energy_eff < 0.5 else (0.03 if energy_eff < 3.0 else 0.02)
    spr = k_scatter * z_eff * x * (1.0 / (1.0 + 0.1 * energy_eff))
    buildup = 1.0 + spr

    transmission_narrow = math.exp(-mu * x) * filter_trans
    transmission_broad = transmission_narrow * buildup

    return {
        "mu": mu,
        "hvl": hvl,
        "tvl": tvl,
        "spr": spr,
        "buildup": buildup,
        "transmission_narrow": transmission_narrow,
        "transmission_broad": transmission_broad
    }


# =====================================================================
# Simulator Class
# =====================================================================
class SRMSimulator:
    def __init__(self):
        # Default geometry details
        self.geom = {
            "outerRadius": 80.0,
            "casingThickness": 8.0,
            "insulationThickness": 4.0,
            "propellantRadius": 68.0,
            "boreRadius": 25.0,
            "boreType": "star",
            "starPoints": 5,
            "starDepth": 0.35
        }

        # Defect preset
        self.defect = {
            "active": True,
            "type": "crack",
            "x": 0.0,
            "y": 45.0,
            "rx": 2.0,
            "ry": 12.0,
            "rz": 6.0,
            "angle": 15.0
        }

        # Settings
        self.settings = {
            "sfd": 1000.0,
            "sod": 800.0,
            "sourceSize": 2.0,
            "gridWidth": 320,
            "gridHeight": 240,
            "energy": "6MeV",
            "mA": 10.0,
            "exposureTime": 120.0,
            "windowCenter": 0.5,
            "windowWidth": 0.8
        }

        self.buffers = {}
        self.init_buffers()

    def init_buffers(self):
        w = self.settings["gridWidth"]
        h = self.settings["gridHeight"]
        shape = (h, w)
        
        components = [
            "primary", "compton", "rayleigh", "forward",
            "backscatter", "lateral", "photoelectric",
            "pairprod", "noise", "blur", "final"
        ]
        for c in components:
            self.buffers[c] = np.zeros(shape, dtype=np.float32)

    def set_settings(self, params):
        resize = False
        if "gridWidth" in params and params["gridWidth"] != self.settings["gridWidth"]:
            resize = True
        if "gridHeight" in params and params["gridHeight"] != self.settings["gridHeight"]:
            resize = True

        self.settings.update(params)
        if resize:
            self.init_buffers()

    # =====================================================================
    # Geometry Ray Intersections
    # =====================================================================
    def intersect_cylinder(self, Sx, Sy, Vx, Vy, R):
        A = Vx**2 + Vy**2
        if A < 1e-12:
            return None

        B = 2.0 * (Sx * Vx + Sy * Vy)
        C = Sx**2 + Sy**2 - R**2

        d = B**2 - 4.0 * A * C
        if d < 0:
            return None

        s = math.sqrt(d)
        t1 = (-B - s) / (2.0 * A)
        t2 = (-B + s) / (2.0 * A)

        entry = max(0.0, min(t1, t2))
        exit = min(1.0, max(t1, t2))

        if entry >= exit:
            return None
        return entry, exit

    def intersect_ellipsoid(self, Sx, Sy, Sz, Vx, Vy, Vz, ell):
        # Translate origin
        sx = Sx - ell["x"]
        sy = Sy - ell["y"]
        sz = Sz - ell.get("z", 0.0)

        # Apply planar rotation
        if ell.get("angle", 0.0) != 0.0:
            rad = -ell["angle"] * math.pi / 180.0
            cos_r = math.cos(rad)
            sin_r = math.sin(rad)
            
            new_sx = sx * cos_r - sy * sin_r
            new_sy = sx * sin_r + sy * cos_r
            sx, sy = new_sx, new_sy

            new_vx = Vx * cos_r - Vy * sin_r
            new_vy = Vx * sin_r + Vy * cos_r
            Vx, Vy = new_vx, new_vy

        # Normalized coordinates relative to ellipsoid axes
        rx, ry, rz = ell["rx"], ell["ry"], ell.get("rz", 6.0)
        
        sx_s, sy_s, sz_s = sx / rx, sy / ry, sz / rz
        vx_s, vy_s, vz_s = Vx / rx, Vy / ry, Vz / rz

        A = vx_s**2 + vy_s**2 + vz_s**2
        B = 2.0 * (sx_s * vx_s + sy_s * vy_s + sz_s * vz_s)
        C = sx_s**2 + sy_s**2 + sz_s**2 - 1.0

        disc = B**2 - 4.0 * A * C
        if disc < 0:
            return None

        sqrt_d = math.sqrt(disc)
        t1 = (-B - sqrt_d) / (2.0 * A)
        t2 = (-B + sqrt_d) / (2.0 * A)

        entry = max(0.0, min(1.0, min(t1, t2)))
        exit = max(0.0, min(1.0, max(t1, t2)))

        if entry >= exit:
            return None
        return entry, exit

    def trace_ray(self, Sx, Sy, Sz, Dx, Dy, Dz):
        Vx, Vy, Vz = Dx - Sx, Dy - Sy, Dz - Sz
        ray_len = math.hypot(Vx, Vy, Vz)

        len_defect = 0.0
        if self.defect["active"]:
            ell_int = self.intersect_ellipsoid(Sx, Sy, Sz, Vx, Vy, Vz, self.defect)
            if ell_int:
                len_defect = (ell_int[1] - ell_int[0]) * ray_len

        # Cylinder segments (Concentric walls)
        R = self.geom["outerRadius"]
        casing = self.intersect_cylinder(Sx, Sy, Vx, Vy, R)
        ins = self.intersect_cylinder(Sx, Sy, Vx, Vy, R - self.geom["casingThickness"])
        prop = self.intersect_cylinder(Sx, Sy, Vx, Vy, R - self.geom["casingThickness"] - self.geom["insulationThickness"])

        len_c = 0.0
        len_i = 0.0
        len_p = 0.0

        if casing:
            len_c = (casing[1] - casing[0]) * ray_len
        if ins:
            len_i = (ins[1] - ins[0]) * ray_len
        if prop:
            len_p = (prop[1] - prop[0]) * ray_len

        len_insul = max(0.0, len_i - len_p)
        len_prop = len_p

        # Inner bore subtraction (Cylindrical or Star-shaped)
        if len_prop > 0:
            bore_r = self.geom["boreRadius"]
            if self.geom["boreType"] == "star":
                avg_bore = bore_r * (1.0 + 0.1 * self.geom["starDepth"])
                bore = self.intersect_cylinder(Sx, Sy, Vx, Vy, avg_bore)
            else:
                bore = self.intersect_cylinder(Sx, Sy, Vx, Vy, bore_r)

            if bore:
                len_bore = (bore[1] - bore[0]) * ray_len
                len_prop = max(0.0, len_prop - len_bore)

        # Defect subtraction
        if len_defect > 0:
            if self.defect["type"] == "delamination":
                len_insul = max(0.0, len_insul - len_defect)
            else:
                len_prop = max(0.0, len_prop - len_defect)

        return len_c, len_insul, len_prop, len_defect

    # =====================================================================
    # Simulation Pipeline
    # =====================================================================
    def run(self):
        w = self.settings["gridWidth"]
        h = self.settings["gridHeight"]

        # 1. Physical machine settings
        energy_key = self.settings["energy"]
        energy_eff = 2.0
        if energy_key == "450keV":
            energy_eff = 0.20
        elif energy_key == "9MeV":
            energy_eff = 3.0

        # Linear attenuation coefficients for each component preset
        def get_coeffs(energy, preset):
            Z = preset["Zeff"]
            rho = preset["density"]
            
            mu_pe = 1.5e-9 * (Z ** 4.0) / (energy ** 3.2) * rho
            alpha = energy / 0.511
            mu_co = 0.40 * (Z / 55.8) * (1.0 / (1.0 + 0.4 * alpha)) * rho
            mu_ra = 1.0e-9 * (Z ** 3.0) / (energy ** 3.0) * rho
            
            mu_pp = 0.0
            if energy > 1.022:
                mu_pp = 1.2e-5 * (Z ** 2.0) * math.log(energy / 1.022) * rho
                
            return {
                "pe": mu_pe, "co": mu_co, "ra": mu_ra, "pp": mu_pp,
                "tot": mu_pe + mu_co + mu_ra + mu_pp
            }

        casing_c = get_coeffs(energy_eff, MATERIAL_PRESETS["steel"])
        insul_c  = get_coeffs(energy_eff, MATERIAL_PRESETS["cfrp"])
        prop_c   = get_coeffs(energy_eff, MATERIAL_PRESETS["propellant"])
        
        defect_c = {"pe": 0, "co": 0, "ra": 0, "pp": 0, "tot": 0}
        if self.defect["active"] and self.defect["type"] == "inclusion":
            defect_c = get_coeffs(energy_eff, MATERIAL_PRESETS["lead"])

        # Setup source location
        Sx, Sy, Sz = 0.0, -self.settings["sod"], 0.0
        detector_y = self.settings["sfd"] - self.settings["sod"]

        # Run ray casting
        xs = np.linspace(-210, 210, w)
        zs = np.linspace(-155, 155, h)
        grid_x, grid_z = np.meshgrid(xs, zs)

        # Clear buffers
        for name in self.buffers:
            self.buffers[name].fill(0.0)

        # Cast rays
        for row in range(h):
            for col in range(w):
                Dx = grid_x[row, col]
                Dz = grid_z[row, col]
                Dy = detector_y

                len_c, len_ins, len_p, len_d = self.trace_ray(Sx, Sy, Sz, Dx, Dy, Dz)
                xC, xI, xP, xD = len_c / 10.0, len_ins / 10.0, len_p / 10.0, len_d / 10.0

                att_pe = xC * casing_c["pe"] + xI * insul_c["pe"] + xP * prop_c["pe"] + xD * defect_c["pe"]
                att_co = xC * casing_c["co"] + xI * insul_c["co"] + xP * prop_c["co"] + xD * defect_c["co"]
                att_ra = xC * casing_c["ra"] + xI * insul_c["ra"] + xP * prop_c["ra"] + xD * defect_c["ra"]
                att_pp = xC * casing_c["pp"] + xI * insul_c["pp"] + xP * prop_c["pp"] + xD * defect_c["pp"]

                att_tot = att_pe + att_co + att_ra + att_pp
                I_primary = math.exp(-att_tot)

                self.buffers["primary"][row, col] = I_primary
                
                if att_tot > 0:
                    p_interacted = 1.0 - I_primary
                    self.buffers["photoelectric"][row, col] = (att_pe / att_tot) * p_interacted
                    self.buffers["pairprod"][row, col] = (att_pp / att_tot) * p_interacted
                    self.buffers["compton"][row, col] = (att_co / att_tot) * p_interacted * I_primary
                    self.buffers["rayleigh"][row, col] = (att_ra / att_tot) * p_interacted * I_primary

        self.simulate_scatter_components(energy_eff)
        self.apply_noise_and_blur()
        self.combine_radiograph()

    # =====================================================================
    # Blurring & Signal Diffusion Filters
    # =====================================================================
    def box_blur(self, data, radius):
        """Pure-NumPy O(N) sliding window average box filter"""
        if radius <= 0:
            return data
        h, w = data.shape
        out = data.copy()
        
        # Horizontal Pass
        for y in range(h):
            row = data[y, :]
            padded = np.pad(row, radius, mode='edge')
            cumsum = np.cumsum(np.insert(padded, 0, 0))
            sliding_sum = cumsum[2*radius+1:] - cumsum[:-2*radius-1]
            out[y, :] = sliding_sum / (2 * radius + 1)
            
        # Vertical Pass
        temp = out.copy()
        for x in range(w):
            col = temp[:, x]
            padded = np.pad(col, radius, mode='edge')
            cumsum = np.cumsum(np.insert(padded, 0, 0))
            sliding_sum = cumsum[2*radius+1:] - cumsum[:-2*radius-1]
            out[:, x] = sliding_sum / (2 * radius + 1)
            
        return out

    def box_blur_horizontal(self, data, radius):
        """Pure-NumPy O(N) horizontal-only sliding window box filter"""
        if radius <= 0:
            return data
        h, w = data.shape
        out = data.copy()
        for y in range(h):
            row = data[y, :]
            padded = np.pad(row, radius, mode='edge')
            cumsum = np.cumsum(np.insert(padded, 0, 0))
            sliding_sum = cumsum[2*radius+1:] - cumsum[:-2*radius-1]
            out[y, :] = sliding_sum / (2 * radius + 1)
        return out

    def simulate_scatter_components(self, energy_eff):
        p_forward = 0.5 + 0.35 * (energy_eff / (1.0 + energy_eff))
        p_back = 0.15 * (1.0 / (1.0 + energy_eff))
        p_lateral = max(0.01, 1.0 - p_forward - p_back)

        compton = self.buffers["compton"]
        rayleigh = self.buffers["rayleigh"]

        # Forward scatter
        self.buffers["forward"] = compton * p_forward + rayleigh * 0.85
        self.buffers["forward"] = self.box_blur(self.buffers["forward"], 15)

        # Backscatter
        self.buffers["backscatter"] = compton * p_back
        self.buffers["backscatter"] = self.box_blur(self.buffers["backscatter"], 40)
        self.buffers["backscatter"] += 0.02

        # Lateral scatter
        self.buffers["lateral"] = compton * p_lateral + rayleigh * 0.15
        self.buffers["lateral"] = self.box_blur_horizontal(self.buffers["lateral"], 25)

    def apply_noise_and_blur(self):
        h, w = self.buffers["primary"].shape
        
        sod = max(1.0, self.settings["sod"])
        sfd = max(sod + 1.0, self.settings["sfd"])
        odd = sfd - sod
        
        ug = self.settings["sourceSize"] * (odd / sod)
        pixel_size = 420.0 / w
        ug_pixels = max(0.5, ug / pixel_size)
        blur_radius = min(10, int(round(ug_pixels)))

        temp_unblurred = (
            self.buffers["primary"] + 
            self.buffers["forward"] + 
            self.buffers["backscatter"] + 
            self.buffers["lateral"]
        )

        temp_blurred = self.box_blur(temp_unblurred.copy(), blur_radius)
        self.buffers["blur"] = temp_blurred - temp_unblurred

        ma = self.settings["mA"]
        exposure = self.settings["exposureTime"]
        fluence = (ma * exposure * 1000.0) / (sfd ** 2)
        noise_factor = 0.025 / math.sqrt(fluence)

        noise_std = noise_factor * np.sqrt(np.maximum(0.001, temp_blurred))
        self.buffers["noise"] = np.random.normal(0.0, noise_std, size=(h, w))

    def combine_radiograph(self):
        win_center = self.settings["windowCenter"]
        win_width = self.settings["windowWidth"]
        
        low = win_center - win_width / 2.0
        high = win_center + win_width / 2.0

        raw_sum = (
            self.buffers["primary"] + 
            self.buffers["forward"] + 
            self.buffers["backscatter"] + 
            self.buffers["lateral"] + 
            self.buffers["blur"] + 
            self.buffers["noise"]
        )
        
        raw_sum = np.clip(raw_sum, 0.0001, 1.0)
        scaled = (raw_sum - low) / win_width
        self.buffers["final"] = np.clip(scaled, 0.0, 1.0)

    # =====================================================================
    # Plotting/Rendering
    # =====================================================================
    def plot_radiograph(self, filename=None):
        film_img = (1.0 - self.buffers["final"]) * 255.0
        
        plt.figure(figsize=(8, 6))
        plt.imshow(film_img, cmap="gray", origin="lower")
        plt.title(f"Simulated Radiograph ({self.settings['energy']} beam)")
        plt.colorbar(label="Gray Level (Exposure)")
        
        if filename:
            plt.savefig(filename, dpi=150, bbox_inches='tight')
            print(f"Saved radiograph to: {filename}")
        else:
            plt.show()
        plt.close()


# =====================================================================
# Main execution CLI
# =====================================================================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RadSIM NDT Monte Carlo Radiography Simulator")
    parser.add_argument("--material", type=str, default="steel", choices=list(MATERIAL_PRESETS.keys()),
                        help="Inspected target material preset")
    parser.add_argument("--thickness", type=float, default=100.0,
                        help="Wall thickness of target casing (mm)")
    parser.add_argument("--energy", type=str, default="6MeV", choices=["450keV", "6MeV", "9MeV"],
                        help="Source machine energy output preset")
    parser.add_argument("--output", type=str, default="radiograph.png",
                        help="Path to save output radiograph image")
    args = parser.parse_args()

    print(f"Initializing simulation model...")
    sim = SRMSimulator()
    
    sim.set_settings({
        "energy": args.energy,
        "gridWidth": 320,
        "gridHeight": 240
    })
    
    sim.geom["casingThickness"] = args.thickness
    
    preset = MATERIAL_PRESETS[args.material]
    print(f"Target Preset: {preset['name']} (Density: {preset['density']} g/cm³, Zeff: {preset['Zeff']})")
    
    print(f"Running Monte Carlo Ray Tracer and scattering diffusion sweeps...")
    sim.run()
    
    sim.plot_radiograph(args.output)
    print("Simulation complete.")
