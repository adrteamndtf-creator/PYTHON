/**
 * physics.js
 * Industrial Radiography Physics Calculations & Machine Selection Engine
 * 
 * Supports:
 * - Real-time attenuation, HVL, TVL, and buildup computations
 * - Semi-empirical mass attenuation estimation based on energy and Zeff
 * - Radiographic Machine Recommendation Engine
 */

// Presets for Materials
const MATERIAL_PRESETS = {
    propellant: {
        name: "HTPB Propellant",
        density: 1.75, // g/cm³
        Zeff: 7.4,     // Effective atomic number
        description: "Solid composite propellant (AP/HTPB/Al)."
    },
    steel: {
        name: "Carbon Steel",
        density: 7.85,
        Zeff: 26.0,
        description: "Standard SRM casing structural material."
    },
    aluminum: {
        name: "Aluminum (6061)",
        density: 2.70,
        Zeff: 13.0,
        description: "Lightweight aerospace casing / filter material."
    },
    cfrp: {
        name: "CFRP (Carbon Fiber)",
        density: 1.60,
        Zeff: 6.0,
        description: "Modern filament-wound composite casing."
    },
    lead: {
        name: "Lead (Shielding)",
        density: 11.34,
        Zeff: 82.0,
        description: "High-density shielding and filter material."
    },
    titanium:
    {
        name: "Titanium",
        density: 4.51,
        Zeff: 22
    },

    copper:
    {
        name: "Copper",
        density: 8.96,
        Zeff: 29
    },

    stainless:
    {
        name: "Stainless Steel",
        density: 7.95,
        Zeff: 26
    },

    magnesium:
    {
        name: "Magnesium",
        density: 1.74,
        Zeff: 12
    },

    nickel:
    {
        name: "Nickel",
        density: 8.90,
        Zeff: 28
    },

    brass:
    {
        name: "Brass",
        density: 8.50,
        Zeff: 30
    }
};

// Machine Presets
const MACHINE_PRESETS = {
    xray450: {
        id: "xray450",
        name: "450 keV X-Ray System",
        maxEnergy: 0.450, // MeV
        effEnergy: 0.200, // MeV
        sourceSizes: [0.4, 1.0, 3.0], // mm (Fine, Medium, Coarse focal spots)
        maxmA: 20.0,
        doseRate1m: 120, // Rad/min at 1m
        costFactor: 1.0,
        portability: "Semi-portable / Bunker"
    },
    linac6: {
        id: "linac6",
        name: "6 MeV LINAC",
        maxEnergy: 6.0,
        effEnergy: 2.0,
        sourceSizes: [1.0, 2.0],
        maxmA: 0.1, // micro-amperes equivalent, not directly compared
        doseRate1m: 800, // Rad/min at 1m
        costFactor: 3.5,
        portability: "Fixed Bunker"
    },
    linac9: {
        id: "linac9",
        name: "9 MeV LINAC",
        maxEnergy: 9.0,
        effEnergy: 3.0,
        sourceSizes: [1.5, 2.5],
        maxmA: 0.15,
        doseRate1m: 3000, // Rad/min at 1m
        costFactor: 5.0,
        portability: "Fixed Bunker"
    }
};

/**
 * Calculates mass attenuation coefficient (cm²/g) using semi-empirical actinide/light element physics.
 * Combines photoelectric, Compton, and pair production estimates.
 * @param {number} energyEff - Effective photon energy in MeV (e.g. 0.2 for 450 keV, 2.0 for 6 MeV, 3.0 for 9 MeV)
 * @param {number} Zeff - Effective atomic number
 * @returns {number} Mass attenuation coefficient (cm²/g)
 */
function getMassAttenuationCoeff(energyEff, Zeff) {
    // 1. Photoelectric contribution: proportional to Z^4 / E^3.2
    const photoelectric = 1.5e-9 * Math.pow(Zeff, 4.0) / Math.pow(energyEff, 3.2);

    // 2. Compton contribution: normalized for electron density (falls slowly with energy)
    const alpha = energyEff / 0.511;
    const compton = 0.40 * (Zeff / 55.8) * (1.0 / (1.0 + 0.4 * alpha));

    // 3. Pair production contribution: above 1.022 MeV
    let pairProduction = 0;
    if (energyEff > 1.022) {
        pairProduction = 1.2e-5 * Math.pow(Zeff, 2.0) * Math.log(energyEff / 1.022);
    }

    return photoelectric + compton + pairProduction;
}

/**
 * Calculates the complete attenuation parameters.
 * @param {string|object} material - Preset name or custom material object {density, Zeff}
 * @param {number} thicknessMm - Thickness in mm
 * @param {number} energyEff - Effective photon energy in MeV
 * @param {object} filter - Filter options {material, thicknessMm}
 */
function calculateAttenuation(material, thicknessMm, energyEff, filter = null) {
    let density = 0;
    let Zeff = 0;
    
    if (typeof material === 'string') {
        const preset = MATERIAL_PRESETS[material.toLowerCase()];
        if (preset) {
            density = preset.density;
            Zeff = preset.Zeff;
        } else {
            // Default fallback
            density = 1.0;
            Zeff = 7.0;
        }
    } else {
        density = material.density || 1.0;
        Zeff = material.Zeff || 7.0;
    }

    // Convert thickness mm -> cm
    const x = thicknessMm / 10.0;

    // Base material linear attenuation coefficient (mu, cm^-1)
    const massMu = getMassAttenuationCoeff(energyEff, Zeff);
    const mu = massMu * density;

    // Calculate filter attenuation if present
    let filterTrans = 1.0;
    let filterMu = 0.0;
    if (filter && filter.thicknessMm > 0) {
        const filterPreset = MATERIAL_PRESETS[filter.material.toLowerCase()];
        if (filterPreset) {
            const filterX = filter.thicknessMm / 10.0;
            const filterMassMu = getMassAttenuationCoeff(energyEff, filterPreset.Zeff);
            filterMu = filterMassMu * filterPreset.density;
            filterTrans = Math.exp(-filterMu * filterX);
        }
    }

    // HVL (Half Value Layer) and TVL (Tenth Value Layer) in mm
    const hvl = mu > 0 ? (Math.log(2) / mu) * 10 : 9999;
    const tvl = mu > 0 ? (Math.log(10) / mu) * 10 : 9999;

    // Estimate Scatter-to-Primary Ratio (SPR)
    // SPR increases with thickness and Zeff (scattering center density), and is generally higher at lower energies
    // but Compton scatter directionality is forward-peaked at high energies.
    // Semi-empirical formula:
    const kScatter = energyEff < 0.5 ? 0.08 : energyEff < 3.0 ? 0.03 : 0.02;
    const spr = kScatter * Zeff * (thicknessMm / 10.0) * (1 / (1 + 0.1 * energyEff));

    // Buildup factor B
    const buildup = 1.0 + spr;

    // Narrow beam transmission (no scatter)
    const transmissionNarrow = Math.exp(-mu * x) * filterTrans;

    // Broad beam transmission (includes scatter buildup)
    const transmissionBroad = transmissionNarrow * buildup;

    return {
        density,
        Zeff,
        mu, // cm^-1
        massMu, // cm²/g
        hvl, // mm
        tvl, // mm
        spr,
        buildup,
        transmissionNarrow,
        transmissionBroad,
        filterTransmission: filterTrans,
        filterMu: filterMu
    };
}

/**
 * Machine Selection Engine
 * Evaluates performance parameters for 450 keV, 6 MeV, and 9 MeV machines.
 * Returns recommendation scores, metrics, and explanatory advice.
 */
function runMachineSelection(inputParams) {
    const thickness = parseFloat(inputParams.thickness); // mm
    const sourceSize = parseFloat(inputParams.sourceSize); // mm
    const sfd = parseFloat(inputParams.sfd); // mm
    const detectorType = inputParams.detectorType; // "film1", "film2", "dda50", "dda100", "dda200"

    const materialType = inputParams.materialType;
    let materialData = {};

    let steelEquivalentThickness = 0;

    if (materialType === 'custom') {
        materialData = {
            density: parseFloat(inputParams.customDensity),
            Zeff: parseFloat(inputParams.customZeff)
        };
        steelEquivalentThickness =
            thickness *
            ((materialData.density * materialData.Zeff) /
             (7.85 * 26));
    } else {
        materialData = MATERIAL_PRESETS[materialType];
        steelEquivalentThickness =
            thickness *
            ((materialData.density * materialData.Zeff) /
             (7.85 * 26));
    }

    // Determine best machine strictly based on real physics (steel equivalent thickness)
    // 450 keV X-Ray: up to 85 mm steel equivalent
    // 6 MeV LINAC: 85 mm to 250 mm steel equivalent
    // 9 MeV LINAC: > 250 mm steel equivalent
    let bestMachine = "xray450";
    if (steelEquivalentThickness <= 85.0) {
        bestMachine = "xray450";
    } else if (steelEquivalentThickness <= 250.0) {
        bestMachine = "linac6";
    } else {
        bestMachine = "linac9";
    }

    // Object-to-detector distance is assumed to be rocket casing radius + spacer, approx 15% of SFD
    const odd = thickness + 20; // object-to-detector distance (approximate)

    // Evaluate each machine preset and compute scores physically
    const results = {};
    const allowedMachines = ["xray450", "linac6", "linac9"];

    for (const key of allowedMachines) {
        const mach = MACHINE_PRESETS[key];
        const phys = calculateAttenuation(materialData, thickness, mach.effEnergy, {
            material: inputParams.filterMaterial || "none",
            thicknessMm: parseFloat(inputParams.filterThickness || 0)
        });

        // 1. Geometric Unsharpness (Ug)
        // Ug = focal_spot * ODD / (SFD - ODD)
        const focalSpot = mach.id === 'xray450' ? sourceSize : (mach.id === 'linac6' ? 1.5 : 2.0);
        const sod = Math.max(1, sfd - odd);
        const ug = (focalSpot * odd) / sod;

        // Ug acceptability limit (ASME Section V: e.g. < 0.5mm for thin, < 1.0mm for heavy sections)
        let maxUgLimit = 1.0;
        if (steelEquivalentThickness < 50.0) maxUgLimit = 0.5;
        else if (steelEquivalentThickness < 75.0) maxUgLimit = 0.75;
        else if (steelEquivalentThickness < 100.0) maxUgLimit = 1.0;
        else maxUgLimit = 1.5;

        let ugScore = 100 - (ug / maxUgLimit) * 100;
        ugScore = Math.max(0, Math.min(100, ugScore));

        // 2. Penetration Score
        // Determined physically: if the thickness is too high for the machine, penetration is 0.
        // If the energy is way too high for thin material, penetration is 100 but penalize contrast.
        let penScore = 100;
        if (mach.id === 'xray450') {
            if (steelEquivalentThickness > 85.0) {
                penScore = Math.max(0, 100 - (steelEquivalentThickness - 85.0) * 4.0);
            }
        } else if (mach.id === 'linac6') {
            if (steelEquivalentThickness < 50.0) {
                penScore = Math.max(10, 100 - (50.0 - steelEquivalentThickness) * 1.8);
            } else if (steelEquivalentThickness > 250.0) {
                penScore = Math.max(0, 100 - (steelEquivalentThickness - 250.0) * 3.0);
            }
        } else if (mach.id === 'linac9') {
            if (steelEquivalentThickness < 120.0) {
                penScore = Math.max(10, 100 - (120.0 - steelEquivalentThickness) * 1.2);
            }
        }

        // 3. Contrast Score
        // Contrast is proportional to mu / (1 + SPR)
        // X-rays have superior contrast, LINACs are lower but necessary.
        let contrastScore = 30;
        if (mach.id === 'xray450') {
            contrastScore = Math.max(30, 95 - (steelEquivalentThickness * 0.4));
        } else if (mach.id === 'linac6') {
            contrastScore = Math.max(20, 55 - (steelEquivalentThickness * 0.1));
        } else if (mach.id === 'linac9') {
            contrastScore = Math.max(15, 35 - (steelEquivalentThickness * 0.05));
        }

        // 4. Defect Detectability
        // Combines contrast, unsharpness, and penetration.
        let detectability = contrastScore * (1.0 / (1.0 + 2.0 * ug)) * (penScore / 100);
        detectability = Math.max(0, Math.min(100, detectability));

        // Overall selection score
        // Weighted average: penetration is critical (40%), unsharpness (20%), contrast (20%), detectability (20%)
        let overallScore = 0;
        if (penScore < 20) {
            overallScore = penScore; // fails if cannot penetrate
        } else {
            overallScore =
                (penScore * 0.40) +
                (ugScore * 0.20) +
                (contrastScore * 0.20) +
                (detectability * 0.20);
        }

        results[mach.id] = {
            machine: mach,
            transmission: phys.transmissionBroad,
            spr: phys.spr,
            ug: ug,
            hvl: phys.hvl,
            tvl: phys.tvl,
            scores: {
                penetration: Math.round(penScore),
                sharpness: Math.round(ugScore),
                contrast: Math.round(contrastScore),
                detectability: Math.round(detectability),
                overall: Math.round(overallScore)
            }
        };
    }

    // Determine recommended focal spot size based on thickness
    let recFocal = 1.0;
    if (bestMachine === 'xray450') {
        if (thickness < 30) recFocal = 0.4;
        else if (thickness < 70) recFocal = 1.0;
        else recFocal = 3.0;
    } else if (bestMachine === 'linac6') {
        recFocal = 1.5; // standard waveguide focus
    } else {
        recFocal = 2.0; // high-energy LINAC focal spot
    }

    // Determine recommended SFD based on geometric unsharpness standard limit (Ug = f * ODD / (SFD - ODD))
    const targetUgLimit = thickness < 50 ? 0.20 : 0.35;
    let recSFDVal = odd * (1 + recFocal / targetUgLimit);
    recSFDVal = Math.min(2000, Math.max(600, Math.round(recSFDVal / 50) * 50)); // Clamp between 600mm and 2000mm

    // Generate dynamic recommendation message based on thickness
    let advice = "";
    if (bestMachine === 'xray450') {
        const recKV = Math.min(450, Math.max(100, Math.round(150 + steelEquivalentThickness * 1.5)));
        const recTime = Math.round(10 + Math.exp(thickness / 30) * 12);
        advice = `The 450 keV X-Ray System is recommended. It offers the highest radiographic contrast due to lower photon energy and a highly adjustable focal spot. The steel equivalent thickness of ${steelEquivalentThickness.toFixed(1)} mm is within the optimal operating range. Recommended settings: ${recKV} kV energy, ${recTime} s exposure time, ${recSFDVal} mm SFD, and a ${recFocal} mm focal spot size to keep unsharpness within standard codes.`;
    } else if (bestMachine === 'linac6') {
        const recTime = Math.round(30 + thickness * 0.6);
        advice = `The 6 MeV LINAC is recommended. The steel equivalent thickness of ${steelEquivalentThickness.toFixed(1)} mm exceeds the effective penetration range of 450 keV X-rays. A megavolt LINAC is required to achieve sufficient detector dose rates and reduce scattering wash-out, while maintaining a smaller focal spot size than the 9 MeV unit. Recommended settings: 6 MeV energy, ${recTime} s exposure time, ${recSFDVal} mm SFD, and a ${recFocal} mm focal spot.`;
    } else {
        const recTime = Math.round(60 + (thickness - 200) * 0.4);
        advice = `The 9 MeV LINAC is recommended. This represents a heavy-section inspection. Extreme steel equivalent thickness of ${steelEquivalentThickness.toFixed(1)} mm requires the highest available photon energy (9 MeV) to achieve reasonable exposure times. Although radiographic contrast is reduced, a 9 MeV beam is essential for penetration. Recommended settings: 9 MeV energy, ${recTime} s exposure time, ${recSFDVal} mm SFD, and a ${recFocal} mm focal spot.`;
    }

    // Film/Detector Selection Logic with specific VSSC film presets:
    let recommendedDetector = "dda100";
    let recommendedDetectorName = "Agfa Structurix D5 / Carestream Industrex T200";
    let detectorAdvice = "";

    if (steelEquivalentThickness <= 50.0) {
        recommendedDetector = "film1";
        recommendedDetectorName = "Agfa Structurix D4 / Carestream Industrex MX125";
        detectorAdvice = `For low-thickness sections (steel equivalent ≤ 50 mm), Class I ultra-fine grain film (Agfa D4 / Carestream MX125) with **0.1 mm Lead (Pb) front and back screens** is recommended. This setup delivers the highest contrast and outstanding sharpness, essential for micro-crack detection. Alternatively, a 50 µm pitch DDA can be used for digital capture.`;
    } else if (steelEquivalentThickness <= 150.0) {
        recommendedDetector = "film2";
        recommendedDetectorName = "Agfa Structurix D5 / Carestream Industrex T200";
        detectorAdvice = `For medium-thickness sections (steel equivalent 50–150 mm), Class I fine grain film (Agfa D5 / Carestream T200) with **1.0 mm Lead (Pb) front screens** and **0.5 mm Lead (Pb) back screens** is recommended. The lead screen filters out low-energy scatter from the 6 MeV LINAC to maximize contrast and sharpness. Alternatively, a 100 µm pixel DDA is suitable.`;
    } else {
        recommendedDetector = "dda200";
        recommendedDetectorName = "Agfa Structurix D7 / Carestream Industrex AA400";
        detectorAdvice = `For heavy sections (steel equivalent > 150 mm), Class II medium grain film (Agfa D7 / Carestream AA400) or a 200 µm pixel DDA is recommended to keep exposure times within practical limits (under 5 minutes). Compton scatter is highly forward-directed at these energies; use **1.5 mm Tantalum (Ta) or Lead (Pb) front screens** to absorb scattered photons and intensify the primary beam.`;
    }

    return {
        bestMachine,
        results,
        advice,
        recommendedDetector,
        recommendedDetectorName,
        detectorAdvice
    };
}

// Export functions for browser environment
window.MATERIAL_PRESETS = MATERIAL_PRESETS;
window.MACHINE_PRESETS = MACHINE_PRESETS;
window.getMassAttenuationCoeff = getMassAttenuationCoeff;
window.calculateAttenuation = calculateAttenuation;
window.runMachineSelection = runMachineSelection;
