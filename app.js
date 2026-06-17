/**
 * app.js
 * Main NDT Application Controller & UI Orchestrator
 * 
 * Sets up listeners, handles tabs, connects the physics, simulator, and DB engines,
 * and maintains interactive charts (Chart.js) and canvas ray-casting instances.
 */

document.addEventListener("DOMContentLoaded", () => {
    // Initialize Lucide Icons
    lucide.createIcons();

    // Core Class Instances
    const simulator = new window.SRMSimulator();
    const db = new window.ProjectDatabase();

    // Chart.js instances
    let radarChart = null;
    let transmissionChart = null;
    let exposureChart = null;

    // Track active tab
    let activeTab = "dashboard";

    // Track dragging state on Schematic canvas
    let isDraggingDefect = false;
    
    // Emergency stop state
    let emergencyActive = false;

    // --- DOM Elements ---
    const navItems = document.querySelectorAll(".nav-item");
    const tabPanels = document.querySelectorAll(".tab-panel");
    const pageTitle = document.getElementById("page-title");
    const pageDesc = document.getElementById("page-desc");

    // Form inputs
    const formParams = document.getElementById("form-parameters");
    const materialTypeSelect = document.getElementById("materialType");
    const customMatInputs = document.getElementById("custom-material-inputs");
    const customDensityInput = document.getElementById("customDensity");
    const customZeffInput = document.getElementById("customZeff");
    const thicknessInput = document.getElementById("thickness");
    const sfdInput = document.getElementById("sfd");
    const sourceSizeInput = document.getElementById("sourceSize");
    const detectorTypeSelect = document.getElementById("detectorType");
    const filterMaterialSelect = document.getElementById("filterMaterial");
    const filterThicknessInput = document.getElementById("filterThickness");
    const filterThicknessContainer = document.getElementById("filter-thickness-container");
    const energyRadios = document.getElementsByName("energy");
    const kvInput = document.getElementById("kv");
    const maInput = document.getElementById("ma");
    const exposureTimeInput = document.getElementById("exposureTime");

    // Value display badges
    const valThickness = document.getElementById("val-thickness");
    const valSfd = document.getElementById("val-sfd");
    const valSourceSize = document.getElementById("val-sourceSize");
    const valFilterThickness = document.getElementById("val-filterThickness");
    const valKv = document.getElementById("val-kv");
    const valMa = document.getElementById("val-ma");
    const valExposureTime = document.getElementById("val-exposureTime");

    // Machine recommendation elements
    const recMachineName = document.getElementById("rec-machine-name");
    const recMachinePortability = document.getElementById("rec-machine-portability");
    const recMachineAdvice = document.getElementById("rec-machine-advice");
    const recMatrixBody = document.getElementById("rec-matrix-body");
    const recHeroCard = document.getElementById("rec-hero-card");

    // Telemetry displays
    const telSource = document.getElementById("tel-source");
    const telEnergy = document.getElementById("tel-energy");
    const telDoserate = document.getElementById("tel-doserate");

    // Exposure module indicators
    const statMu = document.getElementById("stat-mu");
    const statHvl = document.getElementById("stat-hvl");
    const statTvl = document.getElementById("stat-tvl");
    const statBuildup = document.getElementById("stat-buildup");
    const statUg = document.getElementById("stat-ug");

    // Simulation elements
    const srmSchematicCanvas = document.getElementById("srmSchematic");
    const srmRadiographCanvas = document.getElementById("srmRadiograph");
    const simStatsReadout = document.getElementById("sim-stats-readout");
    const simMatSelect = document.getElementById("sim-materialType");
    const simThickInput = document.getElementById("sim-thickness");
    const simValThickBadge = document.getElementById("sim-val-thickness");
    const simEnergyRadios = document.getElementsByName("sim-energy");
    const boreTypeSelect = document.getElementById("boreType");
    const defectActiveCheckbox = document.getElementById("defectActive");
    const defectSubpanel = document.getElementById("defect-subpanel");
    const defectTypeSelect = document.getElementById("defectType");
    const defectXInput = document.getElementById("defectX");
    const defectYInput = document.getElementById("defectY");
    const defectRxInput = document.getElementById("defectRx");
    const defectRyInput = document.getElementById("defectRy");
    const defectAngleInput = document.getElementById("defectAngle");

    const valDefectX = document.getElementById("val-defectX");
    const valDefectY = document.getElementById("val-defectY");
    const valDefectRx = document.getElementById("val-defectRx");
    const valDefectRy = document.getElementById("val-defectRy");
    const valDefectAngle = document.getElementById("val-defectAngle");

    // Windowing controls
    const windowCenterInput = document.getElementById("windowCenter");
    const windowWidthInput = document.getElementById("windowWidth");
    const valWindowCenter = document.getElementById("val-windowCenter");
    const valWindowWidth = document.getElementById("val-windowWidth");

    // Ravana View elements
    const btnToggleRavana = document.getElementById("btn-toggle-ravana");
    const ravanaCollapsedView = document.getElementById("ravana-collapsed-view");
    const ravanaExpandedView = document.getElementById("ravana-expanded-view");
    const ravanaMainCanvas = document.getElementById("ravana-main-canvas");
    const hudReadout = document.getElementById("hud-readout");

    // Database elements
    const dbRunsList = document.getElementById("db-runs-list");
    const adrSelectedRun = document.getElementById("adr-selected-run");
    const btnExportAdr = document.getElementById("btn-export-adr");
    const btnSaveRunModal = document.getElementById("btn-save-run-modal");
    const btnCloseModal = document.getElementById("btn-close-modal");
    const btnCancelSave = document.getElementById("btn-cancel-save");
    const btnConfirmSave = document.getElementById("btn-confirm-save");
    const saveModal = document.getElementById("save-modal");
    const runSaveNameInput = document.getElementById("run-save-name");

    // Emergency button
    const btnEmergencyStop = document.getElementById("btn-emergency-stop");

    // --- Tab Navigation ---
    navItems.forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const tabName = item.getAttribute("data-tab");
            switchTab(tabName);
        });
    });

    function switchTab(tabName) {
        activeTab = tabName;
        
        // Update active class on nav links
        navItems.forEach(n => n.classList.remove("active"));
        const activeNav = Array.from(navItems).find(n => n.getAttribute("data-tab") === tabName);
        if (activeNav) activeNav.classList.add("active");

        // Update active class on panels
        tabPanels.forEach(p => p.classList.remove("active"));
        const activePanel = document.getElementById(`tab-${tabName}`);
        if (activePanel) activePanel.classList.add("active");

        // Update titles
        updateHeaderTitles(tabName);

        // Resize charts on switch to prevent canvas sizing bugs
        setTimeout(() => {
            if (radarChart) radarChart.resize();
            if (transmissionChart) transmissionChart.resize();
            if (exposureChart) exposureChart.resize();
        }, 50);

        // Run energy comparisons if switching to dashboard or comparisons
        if (tabName === "comparison") {
            runEnergyComparisonSweep();
        } else if (tabName === "ravana") {
            updateRavanaView();
        }
    }

    function updateHeaderTitles(tab) {
        const titleMap = {
            dashboard: { t: "Solid Rocket Motor Inspection Dashboard", d: "NDT inspection console, machine parameters, and automated engine suggestions" },
            exposure: { t: "Dynamic Exposure Charts", d: "Linear attenuation, half-value layer curves, and film exposure charts" },
            simulator: { t: "Synthetic Radiograph Monte Carlo Simulator", d: "Interactive 3D geometry slice modeling and raw radiographic film simulator" },
            ravana: { t: "Ravana Decomposed Component Viewer", d: "Deconstruct industrial radiograph summation into 10 distinct physical interaction layers" },
            comparison: { t: "Multi-Energy Comparison Dashboard", d: "Compare radiographic performance side-by-side: 450 keV vs. 6 MeV vs. 9 MeV" },
            database: { t: "Inspection Run Database", d: "Retrieve historical inspection runs and package training datasets for ADR machine learning" }
        };
        const current = titleMap[tab] || { t: "Solid Rocket Motor Inspection", d: "" };
        pageTitle.textContent = current.t;
        pageDesc.textContent = current.d;
    }

    // --- Input Form Coordination ---
    materialTypeSelect.addEventListener("change", () => {
        const val = materialTypeSelect.value;
        if (val === "custom") {
            customMatInputs.classList.remove("hidden");
        } else {
            customMatInputs.classList.add("hidden");
            // Populate preset parameters implicitly
            const preset = window.MATERIAL_PRESETS[val];
            customDensityInput.value = preset.density;
            customZeffInput.value = preset.Zeff;
        }
        processParameterChange();
    });

    filterMaterialSelect.addEventListener("change", () => {
        if (filterMaterialSelect.value === "none") {
            filterThicknessContainer.classList.add("hidden");
            filterThicknessInput.value = 0;
        } else {
            filterThicknessContainer.classList.remove("hidden");
        }
        processParameterChange();
    });

    // Handle energy class radio group
    energyRadios.forEach(radio => {
        radio.addEventListener("change", () => {
            const val = radio.value;
            // Activate kV/mA controls only for 450 keV X-Ray
            if (val === "450keV") {
                kvInput.disabled = false;
                maInput.disabled = false;
                document.getElementById("xray-kv-ma-params").classList.remove("hidden");
            } else {
                kvInput.disabled = true;
                maInput.disabled = true;
                document.getElementById("xray-kv-ma-params").classList.add("hidden");
            }
            // Sync radio button visual toggles
            document.querySelectorAll(".btn-toggle-label").forEach(lbl => {
                lbl.classList.remove("active");
                if (lbl.querySelector("input").checked) {
                    lbl.classList.add("active");
                }
            });
            processParameterChange(true);
        });
    });

    // Monitor input changes
    const rangeInputs = formParams.querySelectorAll("input[type='range'], input[type='number'], select");
    rangeInputs.forEach(input => {
        input.addEventListener("input", processParameterChange);
        input.addEventListener("change", processParameterChange);
    });

    // Bidirectional sync: number input fields -> range sliders
    const badgeInputs = [
        { badge: valThickness, slider: thicknessInput },
        { badge: valSfd, slider: sfdInput },
        { badge: valSourceSize, slider: sourceSizeInput },
        { badge: valFilterThickness, slider: filterThicknessInput },
        { badge: valKv, slider: kvInput },
        { badge: valMa, slider: maInput },
        { badge: valExposureTime, slider: exposureTimeInput },
        { badge: simValThickBadge, slider: simThickInput },
        { badge: valDefectX, slider: defectXInput },
        { badge: valDefectY, slider: defectYInput },
        { badge: valDefectRx, slider: defectRxInput },
        { badge: valDefectRy, slider: defectRyInput },
        { badge: valDefectAngle, slider: defectAngleInput },
        { badge: valWindowCenter, slider: windowCenterInput },
        { badge: valWindowWidth, slider: windowWidthInput }
    ];

    badgeInputs.forEach(({ badge, slider }) => {
        if (badge && slider) {
            badge.addEventListener("input", (e) => {
                let val = parseFloat(e.target.value);
                if (!isNaN(val)) {
                    const min = parseFloat(slider.min);
                    const max = parseFloat(slider.max);
                    if (val < min) val = min;
                    if (val > max) val = max;
                    slider.value = val;
                }
                processParameterChange();
            });
            // Also sync on blur to make sure invalid/empty inputs reset to slider value
            badge.addEventListener("blur", () => {
                badge.value = slider.value;
            });
        }
    });

    function getSelectedEnergy() {
        let activeEnergy = "6MeV";
        energyRadios.forEach(radio => {
            if (radio.checked) activeEnergy = radio.value;
        });
        return activeEnergy;
    }

    function getFormParameters() {
        return {
            materialType: materialTypeSelect.value,
            customDensity: customDensityInput.value,
            customZeff: customZeffInput.value,
            thickness: thicknessInput.value,
            sfd: sfdInput.value,
            sourceSize: sourceSizeInput.value,
            detectorType: detectorTypeSelect.value,
            filterMaterial: filterMaterialSelect.value,
            filterThickness: filterThicknessInput.value,
            energy: getSelectedEnergy(),
            kV: kvInput.value,
            mA: maInput.value,
            exposureTime: exposureTimeInput.value
        };
    }

    /**
     * Triggered on parameter change.
     * Computes values and updates panels/simulations.
     */
    function processParameterChange(isEnergyChange = false) {

          if (emergencyActive) {
            return;
        }

        const params = getFormParameters();
        
        // Update display number inputs (only if not currently focused by user to prevent typing interruption)
        if (document.activeElement !== valThickness) valThickness.value = params.thickness;
        if (document.activeElement !== valSfd) valSfd.value = params.sfd;
        if (document.activeElement !== valSourceSize) valSourceSize.value = params.sourceSize;
        if (document.activeElement !== valFilterThickness) valFilterThickness.value = params.filterThickness;
        if (document.activeElement !== valKv) valKv.value = params.kV;
        if (document.activeElement !== valMa) valMa.value = params.mA;
        if (document.activeElement !== valExposureTime) valExposureTime.value = params.exposureTime;

        // Update machine recommendations matrix and radar plot
        const recResults = window.runMachineSelection(params);
        updateRecommendationUI(recResults);

        // Auto-select recommended energy class if it wasn't a manual energy selection change
        let paramsUpdated = false;
        if (isEnergyChange !== true) {
            const bestKey = recResults.bestMachine;
            const mappedEnergy = bestKey === 'xray450' ? '450keV' : (bestKey === 'linac6' ? '6MeV' : '9MeV');
            const targetRadio = Array.from(energyRadios).find(r => r.value === mappedEnergy);
            if (targetRadio && !targetRadio.checked) {
                targetRadio.checked = true;
                // Update kV/mA controls visibility directly
                if (mappedEnergy === "450keV") {
                    kvInput.disabled = false;
                    maInput.disabled = false;
                    document.getElementById("xray-kv-ma-params").classList.remove("hidden");
                } else {
                    kvInput.disabled = true;
                    maInput.disabled = true;
                    document.getElementById("xray-kv-ma-params").classList.add("hidden");
                }
                // Sync radio button visual toggles
                document.querySelectorAll(".btn-toggle-label").forEach(lbl => {
                    lbl.classList.remove("active");
                    if (lbl.querySelector("input").checked) {
                        lbl.classList.add("active");
                    }
                });
                paramsUpdated = true;
            }
        }

        const currentParams = paramsUpdated ? getFormParameters() : params;

        // Update system telemetry in sidebar
        const activeMachKey = currentParams.energy === "450keV" ? "xray450" : (currentParams.energy === "6MeV" ? "linac6" : "linac9");
        const activeMach = window.MACHINE_PRESETS[activeMachKey];
        telEnergy.textContent = currentParams.energy === "450keV" ? `${currentParams.kV} kV` : `${activeMach.maxEnergy.toFixed(1)} MeV`;
        telDoserate.textContent = currentParams.energy === "450keV" 
            ? `${(currentParams.mA * 6).toFixed(0)} R/m` 
            : `${activeMach.doseRate1m} R/m`;

        // Update attenuation parameters
        let materialData = {};
        if (currentParams.materialType === 'custom') {
            materialData = { density: parseFloat(currentParams.customDensity), Zeff: parseFloat(currentParams.customZeff) };
        } else {
            materialData = window.MATERIAL_PRESETS[currentParams.materialType];
        }
        
        const effEnergy = activeMach.effEnergy;
        const filterData = { material: currentParams.filterMaterial, thicknessMm: parseFloat(currentParams.filterThickness) };
        const atten = window.calculateAttenuation(materialData, parseFloat(currentParams.thickness), effEnergy, filterData);
        
        // Update stats bar on page 2
        statMu.textContent = `${atten.mu.toFixed(3)} cm⁻¹`;
        statHvl.textContent = `${atten.hvl.toFixed(1)} mm`;
        statTvl.textContent = `${atten.tvl.toFixed(1)} mm`;
        statBuildup.textContent = atten.buildup.toFixed(2);
        
        // Geometric unsharpness Ug = focal_spot * odd / sod
        const odd = parseFloat(currentParams.thickness) + 20; // approximate ODD
        const sod = Math.max(1,parseFloat(currentParams.sfd) - odd);
        const focalSpot = currentParams.energy === "450keV" ? parseFloat(currentParams.sourceSize) : (currentParams.energy === "6MeV" ? 1.5 : 2.0);
        const ug = (focalSpot * odd) / sod;
        statUg.textContent = `${ug.toFixed(2)} mm`;

        // Update simulator instance settings
        simulator.setSettings({
            sfd: parseFloat(currentParams.sfd),
            sod: sod,
            sourceSize: focalSpot,
            energy: currentParams.energy,
            kV: parseFloat(currentParams.kV),
            mA: parseFloat(currentParams.mA),
            exposureTime: parseFloat(currentParams.exposureTime),
            filterMaterial: currentParams.filterMaterial,
            filterThickness: parseFloat(currentParams.filterThickness),
            thickness: parseFloat(currentParams.thickness),
            materialType: currentParams.materialType,
            density: parseFloat(materialData.density),
            Zeff: parseFloat(materialData.Zeff)
        });

        if (currentParams.materialType === 'steel') {
            simulator.setGeom({ outerRadius: 80, casingThickness: 75, insulationThickness: 0, propellantRadius: 0 });
        } else if (currentParams.materialType === 'propellant') {
            simulator.setGeom({ outerRadius: 80, casingThickness: 8, insulationThickness: 4, propellantRadius: 68 });
        } else if (currentParams.materialType === 'custom') {
            simulator.setGeom({ outerRadius: 80, casingThickness: 8, insulationThickness: 4, propellantRadius: 68 });
        } else {
            simulator.setGeom({ outerRadius: 80, casingThickness: 10, insulationThickness: 2, propellantRadius: 68 });
        }

        // Run X-Ray simulator & paint canvases
        runSimulatorUpdate();

        // Update charts if they exist
        updateChartsData(materialData, currentParams, activeMach);

        // Synchronize values to simulator tab controls if they exist
        if (simMatSelect) simMatSelect.value = currentParams.materialType;
        if (simThickInput) simThickInput.value = currentParams.thickness;
        if (simValThickBadge && document.activeElement !== simValThickBadge) simValThickBadge.value = currentParams.thickness;

        simEnergyRadios.forEach(radio => {
            const lbl = radio.parentNode;
            if (radio.value === currentParams.energy) {
                radio.checked = true;
                lbl.classList.add("active");
            } else {
                radio.checked = false;
                lbl.classList.remove("active");
            }
        });

        // Auto-update comparison sweep if comparison tab is active
        if (activeTab === "comparison") {
            runEnergyComparisonSweep();
        }
    }

    // --- Machine Selection UI Sync ---
    function updateRecommendationUI(recResults) {
        const bestKey = recResults.bestMachine;
        const results = recResults.results;

        // Update Recommended hero card
        const recMach = results[bestKey].machine;
        recMachineName.textContent = recMach.name;
        recMachinePortability.textContent = `Deployment Class: ${recMach.portability}`;
        recMachineAdvice.textContent = recResults.advice;
        document.getElementById("rec-detector-name").textContent = recResults.recommendedDetectorName;
        document.getElementById("rec-detector-advice").textContent = recResults.detectorAdvice;

        // Style the hero card depending on machine (Megavolt LINAC vs Tube X-Ray)
        if (bestKey === 'xray450') {
            recHeroCard.style.border = "1px solid var(--accent-yellow)";
            recHeroCard.style.background = "linear-gradient(135deg, rgba(255, 188, 0, 0.05) 0%, rgba(15, 18, 32, 0.5) 100%)";
            recMachineName.style.color = "var(--accent-yellow)";
            recMachineName.style.textShadow = "0 0 10px rgba(255, 188, 0, 0.2)";
        } else if (bestKey === 'linac6') {
            recHeroCard.style.border = "1px solid var(--accent-cyan)";
            recHeroCard.style.background = "linear-gradient(135deg, rgba(0, 240, 255, 0.05) 0%, rgba(15, 18, 32, 0.5) 100%)";
            recMachineName.style.color = "var(--accent-cyan)";
            recMachineName.style.textShadow = "0 0 10px rgba(0, 240, 255, 0.2)";
        } else {
            recHeroCard.style.border = "1px solid var(--accent-orange)";
            recHeroCard.style.background = "linear-gradient(135deg, rgba(255, 108, 0, 0.05) 0%, rgba(15, 18, 32, 0.5) 100%)";
            recMachineName.style.color = "var(--accent-orange)";
            recMachineName.style.textShadow = "0 0 10px rgba(255, 108, 0, 0.2)";
        }

        // Rebuild matrix table rows
        let htmlRows = "";
        for (const key of ['xray450', 'linac6', 'linac9']) {
            const res = results[key];
            const isRec = key === bestKey;
            
            // Get badges
            const getBadgeClass = (score) => score > 75 ? 'badge-success' : (score > 35 ? 'badge-warning' : 'badge-error');
            
            const penBadge = `<span class="badge ${getBadgeClass(res.scores.penetration)}">${res.scores.penetration}%</span>`;
            const sharpBadge = `<span class="badge ${getBadgeClass(res.scores.sharpness)}">${res.scores.sharpness}%</span>`;
            const contBadge = `<span class="badge ${getBadgeClass(res.scores.contrast)}">${res.scores.contrast}%</span>`;
            const visBadge = `<span class="badge ${getBadgeClass(res.scores.detectability)}">${res.scores.detectability}%</span>`;

            htmlRows += `
                <tr class="${isRec ? 'highlighted-row' : ''}">
                    <td class="font-bold">${res.machine.name}</td>
                    <td>${penBadge}</td>
                    <td>${sharpBadge}</td>
                    <td>${contBadge}</td>
                    <td>${visBadge}</td>
                    <td class="font-mono ${isRec ? 'text-cyan font-bold' : ''}">${res.scores.overall}%</td>
                </tr>
            `;
        }
        recMatrixBody.innerHTML = htmlRows;

        // Update Radar chart datasets
        if (radarChart) {
            radarChart.data.datasets[0].data = [
                results.xray450.scores.penetration,
                results.xray450.scores.sharpness,
                results.xray450.scores.contrast,
                results.xray450.scores.detectability
            ];
            radarChart.data.datasets[1].data = [
                results.linac6.scores.penetration,
                results.linac6.scores.sharpness,
                results.linac6.scores.contrast,
                results.linac6.scores.detectability
            ];
            radarChart.data.datasets[2].data = [
                results.linac9.scores.penetration,
                results.linac9.scores.sharpness,
                results.linac9.scores.contrast,
                results.linac9.scores.detectability
            ];
            radarChart.update();
        }
    }

    // --- Interactive Charts Setup ---
    function initCharts() {
        // 1. Radar Chart (Machine scores)
        const ctxRadar = document.getElementById("radarChart").getContext("2d");
        radarChart = new Chart(ctxRadar, {
            type: 'radar',
            data: {
                labels: ['Penetration', 'Sharpness', 'Contrast', 'Defect Visibility'],
                datasets: [
                    {
                        label: '450 keV X-Ray',
                        data: [0, 0, 0, 0],
                        borderColor: '#ffbc00',
                        backgroundColor: 'rgba(255, 188, 0, 0.1)',
                        pointBackgroundColor: '#ffbc00',
                        borderWidth: 2
                    },
                    {
                        label: '6 MeV LINAC',
                        data: [0, 0, 0, 0],
                        borderColor: '#00f0ff',
                        backgroundColor: 'rgba(0, 240, 255, 0.1)',
                        pointBackgroundColor: '#00f0ff',
                        borderWidth: 2
                    },
                    {
                        label: '9 MeV LINAC',
                        data: [0, 0, 0, 0],
                        borderColor: '#ff6c00',
                        backgroundColor: 'rgba(255, 108, 0, 0.1)',
                        pointBackgroundColor: '#ff6c00',
                        borderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#8892b0', font: { size: 9, family: 'Inter' } }
                    }
                },
                scales: {
                    r: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        angleLines: { color: 'rgba(255, 255, 255, 0.05)' },
                        pointLabels: { color: '#8892b0', font: { size: 9 } },
                        ticks: { display: false, max: 100 },
                        suggestedMin: 0,
                        suggestedMax: 100
                    }
                }
            }
        });

        // 2. Transmission Curve Chart
        const ctxTrans = document.getElementById("transmissionChart").getContext("2d");
        transmissionChart = new Chart(ctxTrans, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Narrow Beam (No Scatter)',
                        data: [],
                        borderColor: '#8892b0',
                        borderDash: [5, 5],
                        borderWidth: 1.5,
                        fill: false
                    },
                    {
                        label: 'Broad Beam (With Buildup)',
                        data: [],
                        borderColor: '#00f0ff',
                        borderWidth: 2.5,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#8892b0' } }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Thickness (mm)', color: '#8892b0' },
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        ticks: { color: '#8892b0' }
                    },
                    y: {
                        type: 'logarithmic',
                        title: { display: true, text: 'Transmission Ratio (I/I0)', color: '#8892b0' },
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        ticks: {
                            color: '#8892b0',
                            callback: function(value) {
                                return value.toExponential(0);
                            }
                        },
                        min: 1e-6,
                        max: 1.0
                    }
                }
            }
        });

        // 3. Exposure Chart
        const ctxExp = document.getElementById("exposureChart").getContext("2d");
        exposureChart = new Chart(ctxExp, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: '450 keV X-Ray (mA·min)',
                        data: [],
                        borderColor: '#ffbc00',
                        borderWidth: 2,
                        yAxisID: 'y'
                    },
                    {
                        label: '6 MeV LINAC (Total Dose, Rad)',
                        data: [],
                        borderColor: '#00f0ff',
                        borderWidth: 2,
                        yAxisID: 'y1'
                    },
                    {
                        label: '9 MeV LINAC (Total Dose, Rad)',
                        data: [],
                        borderColor: '#ff6c00',
                        borderWidth: 2,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#8892b0' } }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Thickness (mm)', color: '#8892b0' },
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        ticks: { color: '#8892b0' }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: 'Exposure (mA·min)', color: '#ffbc00' },
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        ticks: { color: '#ffbc00' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: 'Dose at 1m (Rad)', color: '#00f0ff' },
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#00f0ff' }
                    }
                }
            }
        });
    }

    function updateChartsData(materialData, params, activeMach) {
        if (!transmissionChart || !exposureChart) return;

        const maxThickness = Math.max(100, Math.ceil(parseFloat(params.thickness) * 1.8));
        const step = Math.ceil(maxThickness / 20);
        
        const labels = [];
        const narrowData = [];
        const broadData = [];
        const exp450Data = [];
        const exp6MData = [];
        const exp9MData = [];

        const effEnergy = activeMach.effEnergy;
        const filterData = { material: params.filterMaterial, thicknessMm: parseFloat(params.filterThickness) };

        const sfdFactor = Math.pow(parseFloat(params.sfd) / 1000, 2);

        for (let t = 0; t <= maxThickness; t += step) {
            labels.push(t);
            
            // Attenuation values
            const attVal = window.calculateAttenuation(materialData, t, effEnergy, filterData);
            narrowData.push(Math.max(1e-6, attVal.transmissionNarrow));
            broadData.push(Math.max(1e-6, attVal.transmissionBroad));

            // Exposure calculations (correct physical equations)
            // 450 keV: Exp (mA·min) = E0 * (SFD/1000)^2 * exp(mu * x) / (B * T_filter)
            const att450 = window.calculateAttenuation(materialData, t, 0.450, filterData); // 450keV
            const exp450 = (0.5 * Math.exp(att450.mu * (t/10.0)) * sfdFactor) / (att450.buildup * att450.filterTransmission);
            exp450Data.push(Math.min(200, exp450));

            // LINAC 6 MeV: Dose at 1m (Rad) = D0 * (SFD/1000)^2 * exp(mu * x) / (B * T_filter)
            const att6M = window.calculateAttenuation(
                materialData,
                t,
                6.0,
                filterData
            );

            const exp6M =
                (15.0 *
                    Math.exp(att6M.mu * (t / 10.0)) *
                    sfdFactor) /
                (att6M.buildup * att6M.filterTransmission);

            exp6MData.push(Math.min(10000, exp6M));

            const att9M = window.calculateAttenuation(
                materialData,
                t,
                9.0,
                filterData
            );

            const exp9M =
                (10.0 *
                    Math.exp(att9M.mu * (t / 10.0)) *
                    sfdFactor) /
                (att9M.buildup * att9M.filterTransmission);

            exp9MData.push(Math.min(10000, exp9M));
          
        }

        // Update Transmission Chart
        transmissionChart.data.labels = labels;
        transmissionChart.data.datasets[0].data = narrowData;
        transmissionChart.data.datasets[1].data = broadData;
        
        // Add vertical line at current thickness using simple plugin or annotations
        // For simplicity we just redraw Chart
        transmissionChart.update();

        // Update Exposure Chart
        exposureChart.data.labels = labels;
        exposureChart.data.datasets[0].data = exp450Data;
        exposureChart.data.datasets[1].data = exp6MData;
        exposureChart.data.datasets[2].data = exp9MData;
        exposureChart.update();
    }

    // --- Defect Placement & Schematic Drawing ---
    boreTypeSelect.addEventListener("change", () => {
        simulator.setGeom({ boreType: boreTypeSelect.value });
        processParameterChange();
    });

    // Custom STL Cache for multi-STL selection
    const srmAssembly = {
        motorCase: null,
        insulation: null,
        propellant: null,
        inhibitor: null,
        voids: null
    };
    const geometrySelect = document.getElementById("geometry-select");
    const srmBoreSubpanel = document.getElementById("srm-bore-subpanel");
    const stlUploadStatus = document.getElementById("stl-upload-status");
    const stlFileInput = document.getElementById("stlUpload");
    const uploadedStlGroup = document.getElementById("uploaded-stl-group");

    if (geometrySelect) {
        geometrySelect.addEventListener("change", () => {
            const val = geometrySelect.value;
            
            if (val === "srm_cylinder") {
                simulator.stlTriangles = null;
                if (srmBoreSubpanel) srmBoreSubpanel.classList.remove("hidden");
                boreTypeSelect.disabled = false;
            } else if (val === "preset_step_wedge") {
                simulator.stlTriangles = simulator.generateStepWedge();
                if (srmBoreSubpanel) srmBoreSubpanel.classList.add("hidden");
                boreTypeSelect.disabled = true;
            } else if (val === "preset_welded_pipe") {
                simulator.stlTriangles = simulator.generateWeldedPipe();
                if (srmBoreSubpanel) srmBoreSubpanel.classList.add("hidden");
                boreTypeSelect.disabled = true;
            } else if (val === "preset_flanged_coupler") {
                simulator.stlTriangles = simulator.generateFlangedCoupler();
                if (srmBoreSubpanel) srmBoreSubpanel.classList.add("hidden");
                boreTypeSelect.disabled = true;
            } else if (val.startsWith("custom_")) {
                const key = val.replace("custom_", "");
                simulator.stlTriangles = customStlCache[key] || null;
                if (srmBoreSubpanel) srmBoreSubpanel.classList.add("hidden");
                boreTypeSelect.disabled = true;
            }
            
            processParameterChange();
        });
    }

    if (stlFileInput) {
        stlFileInput.addEventListener("change", async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;

            let loadedCount = 0;
            let failedCount = 0;
            let lastLoadedName = "";

            for (const file of files) {
                try {
                    const triangles = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            const arrayBuffer = event.target.result;
                            const tris = simulator.parseSTL(arrayBuffer);
                            if (tris && tris.length > 0) {
                                resolve(tris);
                            } else {
                                reject(new Error("Empty mesh"));
                            }
                        };
                        reader.onerror = () => reject(reader.error);
                        reader.readAsArrayBuffer(file);
                    });

                    const key = `${Date.now()}_${file.name}`;
                    const fname = file.name.toLowerCase();

                    if(fname.includes("motor"))
                    {
                        srmAssembly.motorCase = triangles;
                    }
                    else if(fname.includes("insulation"))
                    {
                        srmAssembly.insulation = triangles;
                    }
                    else if(fname.includes("propellant"))
                    {
                        srmAssembly.propellant = triangles;
                    }
                    else if(fname.includes("inhibitor"))
                    {
                        srmAssembly.inhibitor = triangles;
                    }
                    else if(fname.includes("void"))
                    {
                        srmAssembly.voids = triangles;
                    }
                    loadedCount++;
                    lastLoadedName = file.name;
                } catch (err) {
                    failedCount++;
                    console.error("Failed to parse STL:", file.name, err);
                }
            }

            if (loadedCount > 0) {
                // Enable group and clear placeholder
                uploadedStlGroup.disabled = false;
                
                // Rebuild the uploaded group options
                let optionsHtml = "";
                Object.keys(customStlCache).forEach(filename => {
                    optionsHtml += `<option value="custom_${filename}">${filename}</option>`;
                });
                uploadedStlGroup.innerHTML = optionsHtml;

                // Select the last loaded custom file
                geometrySelect.value = `custom_${key}`;
                geometrySelect.dispatchEvent(new Event("change"));

                stlUploadStatus.textContent = `Loaded ${loadedCount} custom STL(s)${failedCount > 0 ? ` (${failedCount} failed)` : ""}.`;
            } else {
                alert(`Failed to load STL file(s). Please check that they are valid ASCII or binary STL meshes.`);
                stlUploadStatus.textContent = `Failed to load selected file(s).`;
            }
        });
    }

    defectActiveCheckbox.addEventListener("change", () => {
        const active = defectActiveCheckbox.checked;
        simulator.setDefect({ active });
        if (active) {
            defectSubpanel.classList.remove("hidden");
        } else {
            defectSubpanel.classList.add("hidden");
        }
        processParameterChange();
    });

    // Wire up defect sliders
    const defectSliders = [defectXInput, defectYInput, defectRxInput, defectRyInput, defectAngleInput];
    defectSliders.forEach(slider => {
        slider.addEventListener("input", () => {
            const params = {
                x: parseFloat(defectXInput.value),
                y: parseFloat(defectYInput.value),
                rx: parseFloat(defectRxInput.value),
                ry: parseFloat(defectRyInput.value),
                angle: parseFloat(defectAngleInput.value)
            };
            
            // Update value badges (only if not focused by user typing)
            if (document.activeElement !== valDefectX) valDefectX.value = params.x;
            if (document.activeElement !== valDefectY) valDefectY.value = params.y;
            if (document.activeElement !== valDefectRx) valDefectRx.value = params.rx;
            if (document.activeElement !== valDefectRy) valDefectRy.value = params.ry;
            if (document.activeElement !== valDefectAngle) valDefectAngle.value = params.angle;

            simulator.setDefect(params);
            runSimulatorUpdate();
        });
    });

    defectTypeSelect.addEventListener("change", () => {
        const type = defectTypeSelect.value;
        simulator.setDefect({ type });
        // Adjust default sizes depending on defect type
        if (type === "crack") {
            defectRxInput.value = 2;
            defectRyInput.value = 12;
            defectAngleInput.value = 15;
        } else if (type === "void") {
            defectRxInput.value = 5;
            defectRyInput.value = 5;
            defectAngleInput.value = 0;
        } else if (type === "delamination") {
            defectRxInput.value = 2;
            defectRyInput.value = 15;
            defectAngleInput.value = 45;
        } else { // inclusion
            defectRxInput.value = 4;
            defectRyInput.value = 4;
            defectAngleInput.value = 0;
        }
        // Sync badge indicators
        defectSliders.forEach(s => s.dispatchEvent(new Event('input')));
    });

    // Windowing slider changes
    [windowCenterInput, windowWidthInput].forEach(slider => {
        slider.addEventListener("input", () => {
            const center = parseFloat(windowCenterInput.value);
            const width = parseFloat(windowWidthInput.value);
            if (document.activeElement !== valWindowCenter) valWindowCenter.value = center.toFixed(2);
            if (document.activeElement !== valWindowWidth) valWindowWidth.value = width.toFixed(2);

            simulator.setSettings({ windowCenter: center, windowWidth: width });
            
            // Re-render simulator canvases (no need to recalculate physics ray-trace!)
            paintSimulatorCanvases();
            if (activeTab === 'ravana') updateRavanaView();
        });
    });

    // Energy comparison layer select listener
    const compLayerSelect = document.getElementById("comparison-layer-select");
    if (compLayerSelect) {
        compLayerSelect.addEventListener("change", () => {
            if (activeTab === "comparison") {
                runEnergyComparisonSweep();
            }
        });
    }

    // Simulator tab material, thickness, and energy synchronization listeners


    if (simMatSelect) {
        simMatSelect.addEventListener("change", () => {
            materialTypeSelect.value = simMatSelect.value;
            materialTypeSelect.dispatchEvent(new Event("change"));
        });
    }

    if (simThickInput) {
        simThickInput.addEventListener("input", () => {
            thicknessInput.value = simThickInput.value;
            thicknessInput.dispatchEvent(new Event("input"));
        });
    }

    simEnergyRadios.forEach(radio => {
        radio.addEventListener("change", () => {
            if (radio.checked) {
                const mainRadio = Array.from(energyRadios).find(r => r.value === radio.value);
                if (mainRadio) {
                    mainRadio.checked = true;
                    mainRadio.dispatchEvent(new Event("change"));
                }
            }
        });
    });

    // Drag-and-drop defect movement on Schematic Canvas
    srmSchematicCanvas.addEventListener("mousedown", (e) => {
        const rect = srmSchematicCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Convert mouse coordinates back to physical space (mm)
        const cx = srmSchematicCanvas.width / 2;
        const cy = srmSchematicCanvas.height / 2 + 30;
        const scale = 220 / (simulator.geom.outerRadius * 2);

        const physX = (mouseX - cx) / scale;
        const physY = (mouseY - cy) / scale;

        // Verify if click is near the defect
        const dx = physX - simulator.defect.x;
        const dy = physY - simulator.defect.y;
        const dist = Math.sqrt(dx*dx + dy*dy);

        if (dist < 25) { // within 25mm tolerance
            isDraggingDefect = true;
            srmSchematicCanvas.style.cursor = "grabbing";
        }
    });

    srmSchematicCanvas.addEventListener("mousemove", (e) => {
        if (!isDraggingDefect) return;

        const rect = srmSchematicCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const cx = srmSchematicCanvas.width / 2;
        const cy = srmSchematicCanvas.height / 2 + 30;
        const scale = 220 / (simulator.geom.outerRadius * 2);

        const physX = Math.round((mouseX - cx) / scale);
        const physY = Math.round((mouseY - cy) / scale);

        // Limit coordinates within propellant region (inner propellant boundary radius ~68)
        const radialDist = Math.sqrt(physX*physX + physY*physY);
        if (radialDist < 65) {
            defectXInput.value = physX;
            defectYInput.value = physY;
            
            // Sync values
            valDefectX.value = physX;
            valDefectY.value = physY;

            simulator.setDefect({ x: physX, y: physY });
            runSimulatorUpdate();
        }
    });

    window.addEventListener("mouseup", () => {
        if (isDraggingDefect) {
            isDraggingDefect = false;
            srmSchematicCanvas.style.cursor = "crosshair";
            processParameterChange(); // full recalc on drop
        }
    });

    /**
     * Compute ray-casting photon transport in Web Worker/Main thread.
     */
    function runSimulatorUpdate() {

              if (emergencyActive) {
            return;
        }
        simulator.run();
        paintSimulatorCanvases();
        
        // Update readout label
        const params = getFormParameters();
        const machineLabels = { "450keV": "450 keV (Tube X-Ray)", "6MeV": "6 MeV (Linac)", "9MeV": "9 MeV (Linac)" };
        simStatsReadout.textContent = `Exposure: ${params.exposureTime}s @ ${machineLabels[params.energy]} with ${params.filterMaterial} filter`;

        // Update secondary views if active
        if (activeTab === 'ravana') {
            updateRavanaView();
        }
    }

    function paintSimulatorCanvases() {
        // Draw 2D Schematic map
        const ctxSchem = srmSchematicCanvas.getContext("2d");
        simulator.renderSchematic(ctxSchem, srmSchematicCanvas.width, srmSchematicCanvas.height);

        // Draw 2D Radiograph film
        const ctxRad = srmRadiographCanvas.getContext("2d");
        simulator.renderToCanvas(ctxRad, "final", srmRadiographCanvas.width, srmRadiographCanvas.height);

        // Draw exposure page small scatter canvases
        const cPrimary = document.getElementById("canvas-exp-primary");
        const cCompton = document.getElementById("canvas-exp-compton");
        const cRayleigh = document.getElementById("canvas-exp-rayleigh");
        if (cPrimary && cCompton && cRayleigh) {
            simulator.renderToCanvas(cPrimary.getContext("2d"), "primary", cPrimary.width, cPrimary.height);
            simulator.renderToCanvas(cCompton.getContext("2d"), "compton", cCompton.width, cCompton.height);
            simulator.renderToCanvas(cRayleigh.getContext("2d"), "rayleigh", cRayleigh.width, cRayleigh.height);

            // Compute and display the exposure page thumbnail percentages
            const w = simulator.settings.gridWidth;
            const h = simulator.settings.gridHeight;
            const N = w * h;
            const buffers = simulator.buffers;

            let sumPrimary = 0, sumCompton = 0, sumRayleigh = 0, sumForward = 0, sumBack = 0, sumLateral = 0;
            for (let i = 0; i < N; i++) {
                sumPrimary += buffers.primary[i];
                sumCompton += buffers.compton[i];
                sumRayleigh += buffers.rayleigh[i];
                sumForward += buffers.forward[i];
                sumBack += buffers.backscatter[i];
                sumLateral += buffers.lateral[i];
            }
            const totalSum = sumPrimary + sumCompton + sumRayleigh + sumForward + sumBack + sumLateral || 1;
            const getPct = (val) => ((val / totalSum) * 100).toFixed(1) + "%";

            const ePrimary = document.getElementById("exp-pct-primary");
            const eCompton = document.getElementById("exp-pct-compton");
            const eRayleigh = document.getElementById("exp-pct-rayleigh");
            if (ePrimary) ePrimary.textContent = getPct(sumPrimary);
            if (eCompton) eCompton.textContent = getPct(sumCompton);
            if (eRayleigh) eRayleigh.textContent = getPct(sumRayleigh);

            // Update Exposure tab thumbnail overlay badges
            const oePrimary = document.getElementById("overlay-exp-pct-primary");
            const oeCompton = document.getElementById("overlay-exp-pct-compton");
            const oeRayleigh = document.getElementById("overlay-exp-pct-rayleigh");
            if (oePrimary) oePrimary.textContent = getPct(sumPrimary);
            if (oeCompton) oeCompton.textContent = getPct(sumCompton);
            if (oeRayleigh) oeRayleigh.textContent = getPct(sumRayleigh);
        }
    }

    // --- Ravana View Module Code ---
    let isRavanaExpanded = false;

    btnToggleRavana.addEventListener("click", () => {
        isRavanaExpanded = !isRavanaExpanded;
        if (isRavanaExpanded) {
            ravanaCollapsedView.classList.add("hidden");
            ravanaExpandedView.classList.remove("hidden");
            btnToggleRavana.innerHTML = `<i data-lucide="minimize-2"></i> Collapse Component Grid`;
            updateRavanaView();
        } else {
            ravanaCollapsedView.classList.remove("hidden");
            ravanaExpandedView.classList.add("hidden");
            btnToggleRavana.innerHTML = `<i data-lucide="fullscreen"></i> Expand Component Grid`;
            updateRavanaView();
        }
        lucide.createIcons();
    });

    function updateRavanaView() {
        if (!isRavanaExpanded) {
            // Draw large single collapsed canvas
            const ctx = ravanaMainCanvas.getContext("2d");
            simulator.renderToCanvas(ctx, "final", ravanaMainCanvas.width, ravanaMainCanvas.height);
        } else {
            // Draw all sub-canvases (including final)
            const components = ["final", "primary", "compton", "rayleigh", "forward", "backscatter", "lateral", "photoelectric", "pairprod", "noise", "blur"];
            components.forEach(comp => {
                const subCanvas = document.getElementById(`c-${comp}`);
                if (subCanvas) {
                    const ctx = subCanvas.getContext("2d");
                    simulator.renderToCanvas(ctx, comp, subCanvas.width, subCanvas.height);
                }
            });

            // Draw the 2D cross-section schematic as a reference card
            const cSchematic = document.getElementById("c-schematic");
            if (cSchematic) {
                const ctx = cSchematic.getContext("2d");
                simulator.renderSchematic(ctx, cSchematic.width, cSchematic.height);
            }

            // Calculate component percentages for the card footers and headers
            const w = simulator.settings.gridWidth;
            const h = simulator.settings.gridHeight;
            const N = w * h;
            const buffers = simulator.buffers;

            let sumPrimary = 0, sumCompton = 0, sumRayleigh = 0, sumForward = 0, sumBack = 0, sumLateral = 0;
            let sumPhotoelectric = 0, sumPairprod = 0, sumNoise = 0, sumBlur = 0;
            for (let i = 0; i < N; i++) {
                sumPrimary += buffers.primary[i];
                sumCompton += buffers.compton[i];
                sumRayleigh += buffers.rayleigh[i];
                sumForward += buffers.forward[i];
                sumBack += buffers.backscatter[i];
                sumLateral += buffers.lateral[i];
                sumPhotoelectric += buffers.photoelectric[i];
                sumPairprod += buffers.pairprod[i];
                sumNoise += Math.abs(buffers.noise[i]);
                sumBlur += Math.abs(buffers.blur[i]);
            }
            const targetIntensity = simulator.targetIntensity || 1.0;
            const normBase = N * targetIntensity || 1;

            // 1. Attenuation Interactions Breakdown (PE + Compton + Rayleigh + PP)
            const totalInteractions = sumCompton + sumRayleigh + sumPhotoelectric + sumPairprod || 1;
            const getInteractionPct = (val) => ((val / totalInteractions) * 100).toFixed(1) + "%";

            // 2. Detector Radiograph Component Breakdown (Primary + Forward + Back + Lateral)
            const totalDetector = sumPrimary + sumForward + sumBack + sumLateral || 1;
            const getDetectorPct = (val) => ((val / totalDetector) * 100).toFixed(1) + "%";

            const getLossPct = (val) => ((val / normBase) * 100).toFixed(1) + "%";

            // Update header badges right next to the titles
            const hPrimary = document.getElementById("header-pct-primary");
            const hCompton = document.getElementById("header-pct-compton");
            const hRayleigh = document.getElementById("header-pct-rayleigh");
            const hForward = document.getElementById("header-pct-forward");
            const hBack = document.getElementById("header-pct-backscatter");
            const hLateral = document.getElementById("header-pct-lateral");
            const hPhotoelectric = document.getElementById("header-pct-photoelectric");
            const hPairprod = document.getElementById("header-pct-pairprod");
            const hNoise = document.getElementById("header-pct-noise");
            const hBlur = document.getElementById("header-pct-blur");

            if (hPrimary) hPrimary.textContent = getDetectorPct(sumPrimary);
            if (hCompton) hCompton.textContent = getInteractionPct(sumCompton);
            if (hRayleigh) hRayleigh.textContent = getInteractionPct(sumRayleigh);
            if (hForward) hForward.textContent = getDetectorPct(sumForward);
            if (hBack) hBack.textContent = getDetectorPct(sumBack);
            if (hLateral) hLateral.textContent = getDetectorPct(sumLateral);
            if (hPhotoelectric) hPhotoelectric.textContent = "Loss: " + getLossPct(sumPhotoelectric);
            if (hPairprod) hPairprod.textContent = "Loss: " + getLossPct(sumPairprod);
            if (hNoise) hNoise.textContent = "±" + getLossPct(sumNoise);
            if (hBlur) hBlur.textContent = "-" + getLossPct(sumBlur);

            // Update Ravana view canvas overlay badges
            const oFinal = document.getElementById("overlay-pct-final");
            const oPrimary = document.getElementById("overlay-pct-primary");
            const oCompton = document.getElementById("overlay-pct-compton");
            const oRayleigh = document.getElementById("overlay-pct-rayleigh");
            const oForward = document.getElementById("overlay-pct-forward");
            const oBack = document.getElementById("overlay-pct-backscatter");
            const oLateral = document.getElementById("overlay-pct-lateral");
            const oPhotoelectric = document.getElementById("overlay-pct-photoelectric");
            const oPairprod = document.getElementById("overlay-pct-pairprod");
            const oNoise = document.getElementById("overlay-pct-noise");
            const oBlur = document.getElementById("overlay-pct-blur");

            if (oFinal) oFinal.textContent = "100%";
            if (oPrimary) oPrimary.textContent = getDetectorPct(sumPrimary);
            if (oCompton) oCompton.textContent = getInteractionPct(sumCompton);
            if (oRayleigh) oRayleigh.textContent = getInteractionPct(sumRayleigh);
            if (oForward) oForward.textContent = getDetectorPct(sumForward);
            if (oBack) oBack.textContent = getDetectorPct(sumBack);
            if (oLateral) oLateral.textContent = getDetectorPct(sumLateral);
            if (oPhotoelectric) oPhotoelectric.textContent = "Loss: " + getLossPct(sumPhotoelectric);
            if (oPairprod) oPairprod.textContent = "Loss: " + getLossPct(sumPairprod);
            if (oNoise) oNoise.textContent = "±" + getLossPct(sumNoise);
            if (oBlur) oBlur.textContent = "-" + getLossPct(sumBlur);

            // Update footer text with dynamic percentages
            const fPrimary = document.getElementById("footer-primary");
            const fCompton = document.getElementById("footer-compton");
            const fRayleigh = document.getElementById("footer-rayleigh");
            const fForward = document.getElementById("footer-forward");
            const fBack = document.getElementById("footer-backscatter");
            const fLateral = document.getElementById("footer-lateral");

            if (fPrimary) fPrimary.textContent = `I_0 · exp(-Σ μ_i · x_i) (${getDetectorPct(sumPrimary)})`;
            if (fCompton) fCompton.textContent = `Dominant scatter component (${getInteractionPct(sumCompton)})`;
            if (fRayleigh) fRayleigh.textContent = `Active at kV energies (${getInteractionPct(sumRayleigh)})`;
            if (fForward) fForward.textContent = `Concentrated edge build-up (${getDetectorPct(sumForward)})`;
            if (fBack) fBack.textContent = `Rear environment reflection (${getDetectorPct(sumBack)})`;
            if (fLateral) fLateral.textContent = `Horizontal secondary scattering (${getDetectorPct(sumLateral)})`;
        }
    }

    // HUD inspection overlay on hover of main collapsed canvas
    ravanaMainCanvas.addEventListener("mousemove", (e) => {
        if (isRavanaExpanded) return;

        const rect = ravanaMainCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Map mouse coordinates to detector resolution (320x240)
        const detX = Math.floor((mouseX / rect.width) * simulator.settings.gridWidth);
        const detY = Math.floor((mouseY / rect.height) * simulator.settings.gridHeight);

        if (detX >= 0 && detX < simulator.settings.gridWidth && detY >= 0 && detY < simulator.settings.gridHeight) {
            const idx = detY * simulator.settings.gridWidth + detX;

            const p = simulator.buffers.primary[idx];
            const c = simulator.buffers.compton[idx];
            const r = simulator.buffers.rayleigh[idx];
            const f = simulator.buffers.forward[idx];
            const b = simulator.buffers.backscatter[idx];
            const l = simulator.buffers.lateral[idx];
            const total = p + c + r + f + b + l || 1;

            // Formulate breakdown percentages
            const getPct = (val) => ((val / total) * 100).toFixed(1);

            hudReadout.innerHTML = `
                X:${detX} Y:${detY} | 
                Primary: ${getPct(p)}% | 
                Compton: ${getPct(c)}% | 
                Rayleigh: ${getPct(r)}% | 
                Forward: ${getPct(f)}% | 
                Back: ${getPct(b)}% | 
                Lateral: ${getPct(l)}%
            `;
        }
    });

    ravanaMainCanvas.addEventListener("mouseleave", () => {
        hudReadout.textContent = "Hover over canvas to view component breakdown...";
    });

    // --- Energy Comparison Sweep Module ---
    function getSimulatorStats() {
        const w = simulator.settings.gridWidth;
        const h = simulator.settings.gridHeight;
        const N = w * h;
        const buffers = simulator.buffers;
        
        let sumPrimary = 0, sumCompton = 0, sumRayleigh = 0, sumForward = 0, sumBack = 0, sumLateral = 0;
        let sumPhotoelectric = 0, sumPairprod = 0, sumNoise = 0, sumBlur = 0;
        for (let i = 0; i < N; i++) {
            sumPrimary += buffers.primary[i];
            sumCompton += buffers.compton[i];
            sumRayleigh += buffers.rayleigh[i];
            sumForward += buffers.forward[i];
            sumBack += buffers.backscatter[i];
            sumLateral += buffers.lateral[i];
            sumPhotoelectric += buffers.photoelectric[i];
            sumPairprod += buffers.pairprod[i];
            sumNoise += Math.abs(buffers.noise[i]);
            sumBlur += Math.abs(buffers.blur[i]);
        }
        
        const totalSum = sumPrimary + sumForward + sumBack + sumLateral || 1;
        const totalScatter = sumForward + sumBack + sumLateral;
        const avgSPR = sumPrimary > 0 ? (totalScatter / sumPrimary) : 0;
        const avgSNR = sumNoise > 0 ? 20 * Math.log10(totalSum / sumNoise) : 80;
        
        return {
            sumPrimary,
            sumCompton,
            sumRayleigh,
            sumForward,
            sumBack,
            sumLateral,
            sumPhotoelectric,
            sumPairprod,
            sumNoise,
            sumBlur,
            totalSum,
            avgSPR,
            avgSNR
        };
    }

    function runEnergyComparisonSweep() {
        const originalEnergy = simulator.settings.energy;
        
        const layerSelect = document.getElementById("comparison-layer-select");
        const compLayer = layerSelect ? layerSelect.value : "final";

        // 1. Run 450 keV
        simulator.setSettings({ energy: "450keV" });
        simulator.run();
        const stats450 = getSimulatorStats();
        const buf450 = new Float32Array(simulator.buffers[compLayer]);

        // 2. Run 6 MeV
        simulator.setSettings({ energy: "6MeV" });
        simulator.run();
        const stats6m = getSimulatorStats();
        const buf6m = new Float32Array(simulator.buffers[compLayer]);

        // 3. Run 9 MeV
        simulator.setSettings({ energy: "9MeV" });
        simulator.run();
        const stats9m = getSimulatorStats();
        const buf9m = new Float32Array(simulator.buffers[compLayer]);

        // Determine global min and max for this layer across the three energy levels
        let globalMin = Infinity;
        let globalMax = -Infinity;

        const checkMinMax = (buf) => {
            for (let i = 0; i < buf.length; i++) {
                const val = buf[i];
                if (val < globalMin) globalMin = val;
                if (val > globalMax) globalMax = val;
            }
        };

        if (compLayer === "final" || compLayer === "primary") {
            const isStl = simulator.stlTriangles && simulator.stlTriangles.length > 0;
            if (isStl) {
                checkMinMax(buf450);
                checkMinMax(buf6m);
                checkMinMax(buf9m);
            } else {
                globalMin = 0;
                globalMax = 1;
            }
        } else {
            checkMinMax(buf450);
            checkMinMax(buf6m);
            checkMinMax(buf9m);
        }

        // Restore active energy and re-run primary simulation
        simulator.setSettings({ energy: originalEnergy });
        simulator.run();

        // Render using global min/max overrides
        const tempBuf = simulator.buffers[compLayer];

        // Render 450 keV
        const canvas450 = document.getElementById("comp-canvas-450");
        simulator.buffers[compLayer] = buf450;
        simulator.renderToCanvas(canvas450.getContext("2d"), compLayer, canvas450.width, canvas450.height, globalMin, globalMax);
        updateComparisonMetricsUI("450", 450, stats450);

        // Render 6 MeV
        const canvas6m = document.getElementById("comp-canvas-6m");
        simulator.buffers[compLayer] = buf6m;
        simulator.renderToCanvas(canvas6m.getContext("2d"), compLayer, canvas6m.width, canvas6m.height, globalMin, globalMax);
        updateComparisonMetricsUI("6m", 6, stats6m);

        // Render 9 MeV
        const canvas9m = document.getElementById("comp-canvas-9m");
        simulator.buffers[compLayer] = buf9m;
        simulator.renderToCanvas(canvas9m.getContext("2d"), compLayer, canvas9m.width, canvas9m.height, globalMin, globalMax);
        updateComparisonMetricsUI("9m", 9, stats9m);

        // Restore original buffer
        simulator.buffers[compLayer] = tempBuf;
    }

    function updateComparisonMetricsUI(energyId, energyVal, stats) {
        const thickness = parseFloat(thicknessInput.value);
        const params = getFormParameters();
        
        const metricBox = document.getElementById(`metrics-${energyId}`);
        if (!metricBox) return;

        const w = simulator.settings.gridWidth;
        const h = simulator.settings.gridHeight;
        const N = w * h;

        // 1. Penetration
        let penetrationText = "Adequate";
        let penClass = "badge-success";
        const normIntensity = stats.totalSum / N;
        if (normIntensity < 1e-4) {
            penetrationText = "Underexposed";
            penClass = "badge-error";
        } else if (normIntensity > 0.85) {
            penetrationText = "Excessive";
            penClass = "badge-warning";
        }

        // 2. Contrast
        let contrastVal = Math.round(stats.sumPrimary / stats.totalSum * 100);
        contrastVal = Math.max(5, Math.min(95, contrastVal));

        // 3. Defect Visibility
        let visibilityText = "High";
        let visClass = "badge-success";
        
        if (normIntensity < 1e-4) {
            visibilityText = "Invisible";
            visClass = "badge-error";
        } else {
            const contrastFactor = stats.sumPrimary / (stats.totalSum + 1e-6);
            const qualityIndex = contrastFactor * stats.avgSNR;
            if (qualityIndex < 8) {
                visibilityText = "Poor";
                visClass = "badge-error";
            } else if (qualityIndex < 22) {
                visibilityText = "Moderate";
                visClass = "badge-warning";
            } else {
                visibilityText = "High";
                visClass = "badge-success";
            }
        }

        // 4. Scattering/Absorption percentages
        const totalInteractions = stats.sumCompton + stats.sumRayleigh + stats.sumPhotoelectric + stats.sumPairprod || 1;
        const comptonPct = ((stats.sumCompton / totalInteractions) * 100).toFixed(1) + "%";
        const rayleighPct = ((stats.sumRayleigh / totalInteractions) * 100).toFixed(1) + "%";
        const photoelectricPct = ((stats.sumPhotoelectric / totalInteractions) * 100).toFixed(1) + "%";
        const pairprodPct = ((stats.sumPairprod / totalInteractions) * 100).toFixed(1) + "%";

        metricBox.innerHTML = `
            <div class="met-row"><span class="met-lbl">Penetration:</span><span class="met-val badge ${penClass}">${penetrationText}</span></div>
            <div class="met-row"><span class="met-lbl">Contrast:</span><span class="met-val">${contrastVal}%</span></div>
            <div class="met-row"><span class="met-lbl">Avg SPR:</span><span class="met-val">${stats.avgSPR.toFixed(2)}</span></div>
            <div class="met-row"><span class="met-lbl">Avg SNR:</span><span class="met-val">${Math.round(stats.avgSNR)} dB</span></div>
            <div class="met-row"><span class="met-lbl">Compton Scatter:</span><span class="met-val text-yellow font-bold">${comptonPct}</span></div>
            <div class="met-row"><span class="met-lbl">Rayleigh Scatter:</span><span class="met-val">${rayleighPct}</span></div>
            <div class="met-row"><span class="met-lbl">Photoelectric Loss:</span><span class="met-val">${photoelectricPct}</span></div>
            <div class="met-row"><span class="met-lbl">Pair Prod Loss:</span><span class="met-val">${pairprodPct}</span></div>
            <div class="met-row"><span class="met-lbl">Defect Visibility:</span><span class="met-val badge ${visClass}">${visibilityText}</span></div>
        `;
    }

    // --- Project Database Module Code ---
    
    // Save Run Modal actions
    btnSaveRunModal.addEventListener("click", () => {
        saveModal.classList.remove("hidden");
        runSaveNameInput.value = `SRM Scan - ${thicknessInput.value}mm ${boreTypeSelect.value === 'star' ? 'Star' : 'Cyl'}`;
    });

    [btnCloseModal, btnCancelSave].forEach(btn => {
        btn.addEventListener("click", () => saveModal.classList.add("hidden"));
    });

    btnConfirmSave.addEventListener("click", () => {
        const name = runSaveNameInput.value;
        const params = getFormParameters();
        const def = simulator.defect;
        
        // Fetch recommendations to store
        const recResults = window.runMachineSelection(params);
        
        // Dummy results mapping
        const results = {
            recommendedMachine: recResults.bestMachine,
            transmission: recResults.results[recResults.bestMachine].transmission,
            spr: recResults.results[recResults.bestMachine].spr,
            contrast: recResults.results[recResults.bestMachine].scores.contrast,
            sharpness: recResults.results[recResults.bestMachine].scores.sharpness,
            snr: recResults.results[recResults.bestMachine].scores.overall - 10,
            defectVisibility: recResults.results[recResults.bestMachine].scores.detectability > 70 ? "High" : "Moderate"
        };

        db.saveRun(name, params, def, results);
        saveModal.classList.add("hidden");
        
        // Refresh tables
        updateDatabaseUI();
    });

    function updateDatabaseUI() {
        const runs = db.getAllRuns();
        
        // Render Database Table list
        let htmlTable = "";
        let htmlSelect = `<option value="">-- Select Run for Export --</option>`;

        runs.forEach(run => {
            const dateStr = new Date(run.timestamp).toLocaleString();
            const defText = run.defect.active ? `${run.defect.type.toUpperCase()} (${run.defect.x},${run.defect.y})` : "None";
            
            htmlTable += `
                <tr>
                    <td class="font-bold">${run.name}</td>
                    <td class="font-mono" style="font-size:0.75rem;">${dateStr}</td>
                    <td>${run.params.thickness}mm (${run.params.materialType.toUpperCase()})</td>
                    <td class="font-mono text-cyan">${run.results.recommendedMachine.toUpperCase()}</td>
                    <td><span class="badge ${run.defect.active ? 'badge-warning' : 'badge-success'}">${defText}</span></td>
                    <td>
                        <button class="btn btn-secondary btn-sm btn-load-run" data-id="${run.id}" style="padding: 4px 8px; font-size:0.75rem;">Load</button>
                        <button class="btn btn-danger btn-sm btn-delete-run" data-id="${run.id}" style="padding: 4px 8px; font-size:0.75rem;">&times;</button>
                    </td>
                </tr>
            `;

            htmlSelect += `<option value="${run.id}">${run.name}</option>`;
        });

        if (runs.length === 0) {
            htmlTable = `<tr><td colspan="6" class="text-center" style="font-style:italic;color:var(--text-muted);">No runs saved. Run a simulation to save.</td></tr>`;
        }

        dbRunsList.innerHTML = htmlTable;
        adrSelectedRun.innerHTML = htmlSelect;

        // Bind dynamic load and delete buttons
        document.querySelectorAll(".btn-load-run").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.getAttribute("data-id");
                loadRunParameters(id);
            });
        });

        document.querySelectorAll(".btn-delete-run").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.getAttribute("data-id");
                if (confirm("Are you sure you want to delete this simulation run?")) {
                    db.deleteRun(id);
                    updateDatabaseUI();
                }
            });
        });
    }

    function loadRunParameters(id) {
        const run = db.getRunById(id);
        if (!run) return;

        // Populate forms
        materialTypeSelect.value = run.params.materialType;
        materialTypeSelect.dispatchEvent(new Event('change'));

        customDensityInput.value = run.params.customDensity;
        customZeffInput.value = run.params.customZeff;
        thicknessInput.value = run.params.thickness;
        sfdInput.value = run.params.sfd;
        sourceSizeInput.value = run.params.sourceSize;
        detectorTypeSelect.value = run.params.detectorType;
        filterMaterialSelect.value = run.params.filterMaterial;
        filterMaterialSelect.dispatchEvent(new Event('change'));
        filterThicknessInput.value = run.params.filterThickness;
        
        // Energy radio select
        energyRadios.forEach(radio => {
            if (radio.value === run.params.energy) {
                radio.checked = true;
                radio.dispatchEvent(new Event('change'));
            }
        });

        kvInput.value = run.params.kV;
        maInput.value = run.params.mA;
        exposureTimeInput.value = run.params.exposureTime;

        // Defect
        defectActiveCheckbox.checked = run.defect.active;
        defectActiveCheckbox.dispatchEvent(new Event('change'));
        defectTypeSelect.value = run.defect.type;
        defectXInput.value = run.defect.x;
        defectYInput.value = run.defect.y;
        defectRxInput.value = run.defect.rx;
        defectRyInput.value = run.defect.ry;
        defectAngleInput.value = run.defect.angle;
        defectSliders.forEach(s => s.dispatchEvent(new Event('input')));

        // Trigger updates & switch to dashboard view
        processParameterChange();
        switchTab("dashboard");
    }

    // Export ADR dataset trigger
    btnExportAdr.addEventListener("click", () => {
        const id = adrSelectedRun.value;
        if (!id) {
            alert("Please select a simulation run from the dropdown first.");
            return;
        }
        const run = db.getRunById(id);
        if (run) {
            db.downloadADRPackage(run, simulator);
        }
    });

    // --- Emergency Stop Warning Button ---
    btnEmergencyStop.addEventListener("click", () => {
        
              emergencyActive = true;
            
        telSource.textContent = "ABORTED";
        telSource.className = "val glow-green text-orange";
        telSource.style.color = "var(--accent-red)";
        telSource.style.textShadow = "0 0 10px var(--accent-red)";
        
        // Flash warning
        alert("EMERGENCY SHUTDOWN TRIGGERED: X-Ray tube filament voltage cut. Linac waveguide primary RF amplifier powered down. Safety interlocks engaged.");
        
        setTimeout(() => {
            telSource.textContent = "ACTIVE";
            telSource.style = "";
            telSource.className = "val glow-green";
        }, 5000);
    });

    // --- Startup initialization ---
    initCharts();
    processParameterChange();
    updateDatabaseUI();
});
