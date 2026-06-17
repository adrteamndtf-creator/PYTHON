/**
 * SRM Radiography Simulator (FIXED VERSION)
 * - Correct class structure
 * - Fixed STL handling
 * - Fixed undefined physics variables
 * - Safe ray tracing
 * - Consistent attenuation model
 */

class SRMSimulator {
    constructor() {

        // Geometry
        this.geom = {
            outerRadius: 80,
            casingThickness: 8,
            insulationThickness: 4,
            propellantRadius: 68,
            boreRadius: 25,
            boreType: "star",
            starPoints: 5,
            starDepth: 0.35,
            length: 150
        };

        // Mesh storage
        this.meshes = {
            motorcase: [],
            insulation: [],
            propellant: [],
            inhibition: [],
            void: []
        };

        this.stlTriangles = [];

        // Defect model
        this.defect = {
            active: true,
            type: "crack",
            x: 0,
            y: 45,
            z: 0,
            rx: 4,
            ry: 12,
            rz: 6,
            angle: 15
        };

        // Imaging settings
        this.settings = {
            sfd: 1000,
            sod: 800,
            sourceSize: 2.0,
            gridWidth: 320,
            gridHeight: 240,
            energy: "6MeV",
            mA: 10,
            exposureTime: 120,
            windowCenter: 0.5,
            windowWidth: 0.8
        };

        this.buffers = {};
        this.componentsList = [
            "primary", "compton", "rayleigh", "forward",
            "backscatter", "lateral", "photoelectric",
            "pairprod", "noise", "blur", "final"
        ];

        this.initBuffers();
    }

    // =========================
    // BUFFER INIT
    // =========================
    initBuffers() {
        const w = this.settings.gridWidth;
        const h = this.settings.gridHeight;

        this.componentsList.forEach(c => {
            this.buffers[c] = new Float32Array(w * h);
        });
    }

    setGeom(p) { Object.assign(this.geom, p); }
    setDefect(p) { Object.assign(this.defect, p); }
    setSettings(p) {
        const resize =
            (p.gridWidth !== undefined && p.gridWidth !== this.settings.gridWidth) ||
            (p.gridHeight !== undefined && p.gridHeight !== this.settings.gridHeight);

        for (const key in p) {
            if (p[key] !== undefined) {
                this.settings[key] = p[key];
            }
        }
        if (resize) this.initBuffers();
    }

    // =========================
    // STL LOADING
    // =========================
    loadSTL(buffer, type) {
        const tris = this.parseSTL(buffer);
        this.meshes[type] = tris || [];
        this.stlTriangles = this.getCombinedMesh();
    }

    getCombinedMesh() {
        if (this.stlTriangles && this.stlTriangles.length > 0) {
            return this.stlTriangles;
        }
        return Object.values(this.meshes).flat();
    }

    parseSTL(arrayBuffer) {
        if (!arrayBuffer) return [];

        const view = new DataView(arrayBuffer);
        if (arrayBuffer.byteLength < 84) return [];

        const text = new TextDecoder().decode(arrayBuffer.slice(0, 80));

        if (text.toLowerCase().includes("solid")) {
            return this.parseASCIISTL(new TextDecoder().decode(arrayBuffer));
        }

        const num = view.getUint32(80, true);
        let offset = 84;
        const tris = [];

        for (let i = 0; i < num; i++) {
            if (offset + 50 > arrayBuffer.byteLength) break;

            const v = (o) => ({
                x: view.getFloat32(offset + o, true),
                y: view.getFloat32(offset + o + 4, true),
                z: view.getFloat32(offset + o + 8, true)
            });

            tris.push({
                normal: v(0),
                v1: v(12),
                v2: v(24),
                v3: v(36)
            });

            offset += 50;
        }

        return tris;
    }

    parseASCIISTL(text) {
        const lines = text.split("\n");
        const tris = [];
        let tri = null;
        let v = 0;

        for (let l of lines) {
            l = l.trim();

            if (l.startsWith("facet normal")) {
                tri = { normal: {}, v1: null, v2: null, v3: null };
                v = 0;
            } else if (l.startsWith("vertex")) {
                const [, x, y, z] = l.split(/\s+/);
                const p = { x: +x, y: +y, z: +z };

                if (v === 0) tri.v1 = p;
                if (v === 1) tri.v2 = p;
                if (v === 2) tri.v3 = p;

                v++;
            } else if (l.startsWith("endfacet")) {
                if (tri?.v1 && tri?.v2 && tri?.v3) tris.push(tri);
            }
        }

        return tris;
    }

    // =========================
    // RAY INTERSECTION
    // =========================
    intersectCylinder(Sx, Sy, Vx, Vy, R) {
        const A = Vx * Vx + Vy * Vy;
        if (A < 1e-12) return null;

        const B = 2 * (Sx * Vx + Sy * Vy);
        const C = Sx * Sx + Sy * Sy - R * R;

        const d = B * B - 4 * A * C;
        if (d < 0) return null;

        const s = Math.sqrt(d);
        let t1 = (-B - s) / (2 * A);
        let t2 = (-B + s) / (2 * A);

        let entry = Math.max(0, Math.min(t1, t2));
        let exit = Math.min(1, Math.max(t1, t2));

        if (entry >= exit) return null;
        return { entry, exit };
    }

    intersectSphere(S, V, s) {
        const sx = S.x - s.x;
        const sy = S.y - s.y;
        const sz = S.z - s.z;

        const A = V.x**2 + V.y**2 + V.z**2;
        const B = 2 * (sx*V.x + sy*V.y + sz*V.z);
        const C = sx*sx + sy*sy + sz*sz - s.r*s.r;

        const d = B*B - 4*A*C;
        if (d < 0) return null;

        const sd = Math.sqrt(d);
        const t1 = (-B - sd) / (2*A);
        const t2 = (-B + sd) / (2*A);

        return {
            entry: Math.max(0, Math.min(t1, t2)),
            exit: Math.max(0, Math.max(t1, t2))
        };
    }

    // =========================
    // ELLIPSOID INTERSECTION FOR DEFECTS
    // =========================
    intersectEllipsoid(S, V, ell) {
        let sx = S.x - ell.x;
        let sy = S.y - ell.y;
        let sz = S.z - ell.z;

        if (ell.angle && ell.angle !== 0) {
            const rad = -ell.angle * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            
            const newSx = sx * cos - sy * sin;
            const newSy = sx * sin + sy * cos;
            sx = newSx;
            sy = newSy;

            const newVx = V.x * cos - V.y * sin;
            const newVy = V.x * sin + V.y * cos;
            V = { x: newVx, y: newVy, z: V.z };
        }

        const sxS = sx / ell.rx;
        const syS = sy / ell.ry;
        const szS = sz / (ell.rz || 6.0); // Fallback if rz is not set

        const vxS = V.x / ell.rx;
        const vyS = V.y / ell.ry;
        const vzS = V.z / (ell.rz || 6.0);

        const A = vxS * vxS + vyS * vyS + vzS * vzS;
        const B = 2 * (sxS * vxS + syS * vyS + szS * vzS);
        const C = sxS * sxS + syS * syS + szS * szS - 1.0;

        const disc = B * B - 4 * A * C;
        if (disc < 0) return null;

        const sqrtD = Math.sqrt(disc);
        const t1 = (-B - sqrtD) / (2 * A);
        const t2 = (-B + sqrtD) / (2 * A);

        const entry = Math.max(0, Math.min(1, Math.min(t1, t2)));
        const exit = Math.max(0, Math.min(1, Math.max(t1, t2)));

        if (entry >= exit) return null;
        return { entry, exit };
    }

    // =========================
    // CORE TRACE
    // =========================
    traceRay(Sx, Sy, Sz, Dx, Dy, Dz) {
        let lenDefect = 0;
        if (this.defect.active) {
            const S = { x: Sx, y: Sy, z: Sz };
            const V = { x: Dx - Sx, y: Dy - Sy, z: Dz - Sz };
            const defInt = this.intersectEllipsoid(S, V, this.defect);
            if (defInt) {
                const rayLen = Math.hypot(V.x, V.y, V.z);
                lenDefect = (defInt.exit - defInt.entry) * rayLen;
            }
        }

        if (this.stlTriangles && this.stlTriangles.length > 0) {
            return this.traceMeshRay(Sx, Sy, Sz, Dx, Dy, Dz, lenDefect);
        }

        const Vx = Dx - Sx;
        const Vy = Dy - Sy;
        const Vz = Dz - Sz;
        const len = Math.hypot(Vx, Vy, Vz);

        const R = this.geom.outerRadius;

        const casing = this.intersectCylinder(Sx, Sy, Vx, Vy, R);
        const ins = this.intersectCylinder(Sx, Sy, Vx, Vy, R - this.geom.casingThickness);
        const prop = this.intersectCylinder(Sx, Sy, Vx, Vy, R - this.geom.casingThickness - this.geom.insulationThickness);

        let lenC = 0, lenI = 0, lenP = 0;

        if (casing) {
            lenC = (casing.exit - casing.entry) * len;
        }
        if (ins) {
            lenI = (ins.exit - ins.entry) * len;
        }
        if (prop) {
            lenP = (prop.exit - prop.entry) * len;
        }

        let lenInsul = Math.max(0, lenI - lenP);
        let lenProp = lenP;

        if (lenDefect > 0) {
            if (this.defect.type === "delamination") {
                lenInsul = Math.max(0, lenInsul - lenDefect);
            } else {
                lenProp = Math.max(0, lenProp - lenDefect);
            }
        }

        return {
            casing: lenC,
            insulation: lenInsul,
            propellant: lenProp,
            defect: lenDefect
        };
    }

    traceMeshRay(Sx, Sy, Sz, Dx, Dy, Dz, lenDefect) {
        const hits = [];
        const origin = { x: Sx, y: Sy, z: Sz };
        const dir = { x: Dx - Sx, y: Dy - Sy, z: Dz - Sz };

        for (const tri of this.stlTriangles) {
            const t = this.rayTriangleIntersect(origin, dir, tri);
            if (t !== null) hits.push(t);
        }

        hits.sort((a, b) => a - b);

        const rayLen = Math.hypot(dir.x, dir.y, dir.z);
        let totalT = 0;
        for (let i = 0; i < hits.length - 1; i += 2) {
            totalT += (hits[i+1] - hits[i]);
        }
        let totalThickness = totalT * rayLen;

        const selectedThickness = this.settings.thickness !== undefined ? this.settings.thickness : 150;
        const scaleFactor = selectedThickness / 150;
        let lenC = totalThickness * scaleFactor;
        let lenI = 0;
        let lenP = 0;

        if (lenDefect > 0) {
            lenC = Math.max(0, lenC - lenDefect);
        }

        return {
            casing: lenC,
            insulation: lenI,
            propellant: lenP,
            defect: lenDefect
        };
    }
       rayTriangleIntersect(
    O,
    D,
    tri
){

    const EPS = 1e-6;

    const v0 = tri.v1;
    const v1 = tri.v2;
    const v2 = tri.v3;

    const edge1 = {
        x:v1.x-v0.x,
        y:v1.y-v0.y,
        z:v1.z-v0.z
    };

    const edge2 = {
        x:v2.x-v0.x,
        y:v2.y-v0.y,
        z:v2.z-v0.z
    };

    const h = {

        x:D.y*edge2.z-D.z*edge2.y,

        y:D.z*edge2.x-D.x*edge2.z,

        z:D.x*edge2.y-D.y*edge2.x

    };

    const a =
        edge1.x*h.x+
        edge1.y*h.y+
        edge1.z*h.z;

    if(Math.abs(a)<EPS)
        return null;

    const f = 1/a;

    const s = {

        x:O.x-v0.x,
        y:O.y-v0.y,
        z:O.z-v0.z

    };

    const u =
        f*(
        s.x*h.x+
        s.y*h.y+
        s.z*h.z);

    if(u<0||u>1)
        return null;

    const q = {

        x:s.y*edge1.z-s.z*edge1.y,

        y:s.z*edge1.x-s.x*edge1.z,

        z:s.x*edge1.y-s.y*edge1.x

    };

    const v =
        f*(
        D.x*q.x+
        D.y*q.y+
        D.z*q.z);

    if(v<0||u+v>1)
        return null;

    const t =
        f*(
        edge2.x*q.x+
        edge2.y*q.y+
        edge2.z*q.z);

    if(t>EPS)
        return t;

    return null;

}


    // =========================
    // MAIN SIMULATION
    // =========================
    run() {
        const w = this.settings.gridWidth;
        const h = this.settings.gridHeight;
        const N = w * h;

        let energyEff = 2.0;
        if (this.settings.energy === "450keV") {
            energyEff = 0.20;
        } else if (this.settings.energy === "9MeV") {
            energyEff = 3.0;
        }

        // Helper function for linear attenuation coefficients
        const getMaterialCoeffs = (energyEff, preset) => {
            if (!preset) return { muPE: 0.01, muCO: 0.02, muRA: 0.002, muPP: 0.0, muTot: 0.032 };
            const Zeff = preset.Zeff;
            const density = preset.density;

            // 1. Photoelectric: Z^4 / E^3.2 (dominant at low energy and high-Z)
            const muPE = 1.5e-9 * Math.pow(Zeff, 4.0) / Math.pow(energyEff, 3.2) * density;
            
            // 2. Compton: Klein-Nishina empirical approximation (dominant at 100 keV - 5 MeV)
            const alpha = energyEff / 0.511;
            const muCO = 0.40 * (Zeff / 55.8) * (1.0 / (1.0 + 0.4 * alpha)) * density;
            
            // 3. Rayleigh: Z^3 / E^3 (negligible above 100 keV)
            const muRA = 1.0e-9 * Math.pow(Zeff, 3.0) / Math.pow(energyEff, 3.0) * density;
            
            // 4. Pair Production: above 1.022 MeV threshold, grows as Z^2
            let muPP = 0;
            if (energyEff > 1.022) {
                muPP = 1.2e-5 * Math.pow(Zeff, 2.0) * Math.log(energyEff / 1.022) * density;
            }
            
            const muTot = muPE + muCO + muRA + muPP;
            return { muPE, muCO, muRA, muPP, muTot };
        };

        const presets = window.MATERIAL_PRESETS || {};
        const casingCoeffs = getMaterialCoeffs(energyEff, presets.steel || { density: 7.85, Zeff: 26 });
        const insulationCoeffs = getMaterialCoeffs(energyEff, presets.cfrp || { density: 1.6, Zeff: 6 });
        const propellantCoeffs = getMaterialCoeffs(energyEff, presets.propellant || { density: 1.75, Zeff: 7.4 });

        const activeMaterialPreset = {
            density: this.settings.density !== undefined ? this.settings.density : 7.85,
            Zeff: this.settings.Zeff !== undefined ? this.settings.Zeff : 26
        };
        const meshCoeffs = getMaterialCoeffs(energyEff, activeMaterialPreset);
        const isStl = this.stlTriangles && this.stlTriangles.length > 0;
        const currentCasingCoeffs = isStl ? meshCoeffs : casingCoeffs;

        const defectCoeffs = this.defect.type === "inclusion"
            ? getMaterialCoeffs(energyEff, presets.lead || { density: 11.34, Zeff: 82 })
            : { muPE: 0, muCO: 0, muRA: 0, muPP: 0, muTot: 0 };

        const Sx = 0, Sy = -this.settings.sod, Sz = 0;

        // Clear all buffers
        this.componentsList.forEach(c => this.buffers[c].fill(0));

        // Trace primary rays
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const Dx = (x / w - 0.5) * 420;
                const Dz = (y / h - 0.5) * 310;

                const path = this.traceRay(Sx, Sy, Sz, Dx, this.settings.sfd - this.settings.sod, Dz);

                const xC = path.casing / 10.0;
                const xI = path.insulation / 10.0;
                const xP = path.propellant / 10.0;
                const xD = path.defect / 10.0;

                const attPE = xC * currentCasingCoeffs.muPE + xI * insulationCoeffs.muPE + xP * propellantCoeffs.muPE + xD * defectCoeffs.muPE;
                const attCO = xC * currentCasingCoeffs.muCO + xI * insulationCoeffs.muCO + xP * propellantCoeffs.muCO + xD * defectCoeffs.muCO;
                const attRA = xC * currentCasingCoeffs.muRA + xI * insulationCoeffs.muRA + xP * propellantCoeffs.muRA + xD * defectCoeffs.muRA;
                const attPP = xC * currentCasingCoeffs.muPP + xI * insulationCoeffs.muPP + xP * propellantCoeffs.muPP + xD * defectCoeffs.muPP;
                
                const attTot = attPE + attCO + attRA + attPP;

                const idx = y * w + x;
                const I_primary = Math.exp(-attTot);
                this.buffers.primary[idx] = I_primary;

                if (attTot > 0) {
                    const P_interacted = 1.0 - I_primary;
                    this.buffers.photoelectric[idx] = (attPE / attTot) * P_interacted;
                    this.buffers.pairprod[idx] = (attPP / attTot) * P_interacted;
                    this.buffers.compton[idx] = (attCO / attTot) * P_interacted * I_primary;
                    this.buffers.rayleigh[idx] = (attRA / attTot) * P_interacted * I_primary;
                }
            }
        }

        // Apply scattering components (diffuse scattering and blurs)
        this.simulateScatterComponents();
        // Apply geometric unsharpness and quantum noise
        this.applyNoiseAndBlur();
        // Sum components into final radiograph
        this.combineRadiograph();
    }

    simulateScatterComponents() {
        const w = this.settings.gridWidth;
        const h = this.settings.gridHeight;
        const N = w * h;

        const comptonGen = this.buffers.compton;
        const rayleighGen = this.buffers.rayleigh;

        const forward = this.buffers.forward;
        const backscatter = this.buffers.backscatter;
        const lateral = this.buffers.lateral;

        let energyEff = 2.0;
        if (this.settings.energy === "450keV") energyEff = 0.20;
        else if (this.settings.energy === "9MeV") energyEff = 3.0;

        const P_forward = 0.5 + 0.35 * (energyEff / (1.0 + energyEff));
        const P_back = 0.15 * (1.0 / (1.0 + energyEff));
        const P_lateral = Math.max(0.01, 1.0 - P_forward - P_back);

        const P_rayleigh_forward = 0.85;
        const P_rayleigh_lateral = 0.15;

        for (let i = 0; i < N; i++) {
            forward[i] = comptonGen[i] * P_forward + rayleighGen[i] * P_rayleigh_forward;
            backscatter[i] = comptonGen[i] * P_back;
            lateral[i] = comptonGen[i] * P_lateral + rayleighGen[i] * P_rayleigh_lateral;
        }

        this.boxBlur(forward, w, h, 15);
        this.boxBlur(backscatter, w, h, 40);
        for (let i = 0; i < N; i++) {
            backscatter[i] = Math.max(0.01, backscatter[i] + 0.02);
        }
        this.boxBlurHorizontalOnly(lateral, w, h, 25);
    }

    applyNoiseAndBlur() {
        const w = this.settings.gridWidth;
        const h = this.settings.gridHeight;
        const N = w * h;

        const primary = this.buffers.primary;
        const forward = this.buffers.forward;
        const backscatter = this.buffers.backscatter;
        const lateral = this.buffers.lateral;
        const noise = this.buffers.noise;
        const blur = this.buffers.blur;

        const sod = Math.max(1, this.settings.sod);
        const sfd = Math.max(sod + 1, this.settings.sfd);
        const Ug = this.settings.sourceSize * ((sfd - sod) / sod);
        
        const pixelSize = 420 / w; 
        const Ug_pixels = Math.max(0.5, Ug / pixelSize);
        const blurRadius = Math.min(10, Math.round(Ug_pixels));

        const tempUnblurred = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            tempUnblurred[i] = primary[i] + forward[i] + backscatter[i] + lateral[i];
        }

        const tempBlurred = new Float32Array(tempUnblurred);
        if (blurRadius > 0) {
            this.boxBlur(tempBlurred, w, h, blurRadius);
        }

        for (let i = 0; i < N; i++) {
            blur[i] = tempBlurred[i] - tempUnblurred[i];
        }

        const mA = this.settings.mA || 10;
        const exposureTime = this.settings.exposureTime || 120;
        const fluence = (mA * exposureTime * 1000) / (sfd * sfd);
        const noiseFactor = 0.025 / Math.sqrt(fluence);

        const randomGaussian = () => {
            let u = 0, v = 0;
            while(u === 0) u = Math.random();
            while(v === 0) v = Math.random();
            return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        };

        for (let i = 0; i < N; i++) {
            const val = tempBlurred[i];
            const stdDev = noiseFactor * Math.sqrt(Math.max(0.001, val));
            noise[i] = randomGaussian() * stdDev;
        }
    }

    combineRadiograph() {
        const w = this.settings.gridWidth;
        const h = this.settings.gridHeight;
        const N = w * h;

        const f = this.buffers.final;
        const primary = this.buffers.primary;
        const forward = this.buffers.forward;
        const backscatter = this.buffers.backscatter;
        const lateral = this.buffers.lateral;
        const noise = this.buffers.noise;
        const blur = this.buffers.blur;

        const winCenter = this.settings.windowCenter || 0.5;
        const winWidth = this.settings.windowWidth || 0.8;
        const low = winCenter - winWidth / 2;
        const high = winCenter + winWidth / 2;

        for (let i = 0; i < N; i++) {
            let val = primary[i] + forward[i] + backscatter[i] + lateral[i] + blur[i] + noise[i];
            val = Math.max(0.0001, Math.min(1.0, val));
            
            let scaledVal = (val - low) / winWidth;
            scaledVal = Math.max(0, Math.min(1.0, scaledVal));
            
            f[i] = scaledVal;
        }
    }

    boxBlur(data, w, h, radius) {
        if (radius <= 0) return;
        const temp = new Float32Array(w * h);

        // Horizontal pass
        for (let y = 0; y < h; y++) {
            let sum = 0;
            const rowOffset = y * w;
            
            // Initialize sum for first window
            for (let x = -radius; x <= radius; x++) {
                const nx = Math.max(0, Math.min(w - 1, x));
                sum += data[rowOffset + nx];
            }
            temp[rowOffset + 0] = sum / (2 * radius + 1);

            for (let x = 1; x < w; x++) {
                const prevX = x - radius - 1;
                const nextX = x + radius;
                const prevPixelVal = data[rowOffset + Math.max(0, prevX)];
                const nextPixelVal = data[rowOffset + Math.min(w - 1, nextX)];
                sum += nextPixelVal - prevPixelVal;
                temp[rowOffset + x] = sum / (2 * radius + 1);
            }
        }

        // Vertical pass
        for (let x = 0; x < w; x++) {
            let sum = 0;
            
            // Initialize sum for first window
            for (let y = -radius; y <= radius; y++) {
                const ny = Math.max(0, Math.min(h - 1, y));
                sum += temp[ny * w + x];
            }
            data[0 * w + x] = sum / (2 * radius + 1);

            for (let y = 1; y < h; y++) {
                const prevY = y - radius - 1;
                const nextY = y + radius;
                const prevPixelVal = temp[Math.max(0, prevY) * w + x];
                const nextPixelVal = temp[Math.min(h - 1, nextY) * w + x];
                sum += nextPixelVal - prevPixelVal;
                data[y * w + x] = sum / (2 * radius + 1);
            }
        }
    }

    boxBlurHorizontalOnly(data, w, h, radius) {
        if (radius <= 0) return;
        const temp = new Float32Array(w * h);

        for (let y = 0; y < h; y++) {
            let sum = 0;
            const rowOffset = y * w;
            
            for (let x = -radius; x <= radius; x++) {
                const nx = Math.max(0, Math.min(w - 1, x));
                sum += data[rowOffset + nx];
            }
            temp[rowOffset + 0] = sum / (2 * radius + 1);

            for (let x = 1; x < w; x++) {
                const prevX = x - radius - 1;
                const nextX = x + radius;
                const prevPixelVal = data[rowOffset + Math.max(0, prevX)];
                const nextPixelVal = data[rowOffset + Math.min(w - 1, nextX)];
                sum += nextPixelVal - prevPixelVal;
                temp[rowOffset + x] = sum / (2 * radius + 1);
            }
        }

        for (let i = 0; i < w * h; i++) {
            data[i] = temp[i];
        }
    }

    // =========================
    // RENDER
    // =========================
    renderToCanvas(ctx, name, w, h, minOverride = null, maxOverride = null) {
        const buf = this.buffers[name];
        const gridW = this.settings.gridWidth;
        const gridH = this.settings.gridHeight;
        const img = ctx.createImageData(gridW, gridH);

        if (name === "final" || name === "primary") {
            const isStl = this.stlTriangles && this.stlTriangles.length > 0;
            let min = minOverride !== null ? minOverride : Infinity;
            let max = maxOverride !== null ? maxOverride : -Infinity;
            
            if (minOverride === null || maxOverride === null) {
                if (isStl) {
                    for (let i = 0; i < buf.length; i++) {
                        const val = buf[i];
                        if (val < min) min = val;
                        if (val > max) max = val;
                    }
                } else {
                    min = 0;
                    max = 1;
                }
            }

            const range = max - min || 1e-6;

            for (let i = 0; i < buf.length; i++) {
                const v = Math.min(1.0, Math.max(0.0, (buf[i] - min) / range));
                const g = (1 - v) * 255;

                img.data[i*4+0] = g;
                img.data[i*4+1] = g;
                img.data[i*4+2] = g;
                img.data[i*4+3] = 255;
            }
        } else {
            let min = minOverride !== null ? minOverride : Infinity;
            let max = maxOverride !== null ? maxOverride : -Infinity;
            
            if (minOverride === null || maxOverride === null) {
                for (let i = 0; i < buf.length; i++) {
                    const val = buf[i];
                    if (val < min) min = val;
                    if (val > max) max = val;
                }
            }

            const range = max - min || 1e-6;

            for (let i = 0; i < buf.length; i++) {
                const v = Math.min(1.0, Math.max(0.0, (buf[i] - min) / range));
                const g = (1 - v) * 255;

                img.data[i*4+0] = g;
                img.data[i*4+1] = g;
                img.data[i*4+2] = g;
                img.data[i*4+3] = 255;
            }
        }

        if (w === gridW && h === gridH) {
            ctx.putImageData(img, 0, 0);
        } else {
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = gridW;
            tempCanvas.height = gridH;
            tempCanvas.getContext("2d").putImageData(img, 0, 0);

            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(tempCanvas, 0, 0, w, h);
        }
    }

    renderSchematic(ctx, w, h, activeRayIndex = -1) {
        const mesh = this.getCombinedMesh();
        if (mesh.length > 0) {
            ctx.fillStyle = "#0c0f12";
            ctx.fillRect(0, 0, w, h);
            
            const cx = w / 2;
            const cy = h / 2 + 10;
            
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < mesh.length; i++) {
                const tri = mesh[i];
                minX = Math.min(minX, tri.v1.x, tri.v2.x, tri.v3.x);
                maxX = Math.max(maxX, tri.v1.x, tri.v2.x, tri.v3.x);
                minY = Math.min(minY, tri.v1.y, tri.v2.y, tri.v3.y);
                maxY = Math.max(maxY, tri.v1.y, tri.v2.y, tri.v3.y);
            }
            
            const stlW = maxX - minX || 200;
            const stlH = maxY - minY || 200;
            const scale = Math.min(w * 0.6 / stlW, h * 0.6 / stlH);
            
            ctx.strokeStyle = "rgba(0, 240, 255, 0.4)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            
            const step = Math.max(1, Math.floor(mesh.length / 500));
            for (let i = 0; i < mesh.length; i += step) {
                const tri = mesh[i];
                const x1 = cx + (tri.v1.x - (minX + maxX)/2) * scale;
                const y1 = cy + (tri.v1.y - (minY + maxY)/2) * scale;
                const x2 = cx + (tri.v2.x - (minX + maxX)/2) * scale;
                const y2 = cy + (tri.v2.y - (minY + maxY)/2) * scale;
                const x3 = cx + (tri.v3.x - (minX + maxX)/2) * scale;
                const y3 = cy + (tri.v3.y - (minY + maxY)/2) * scale;
                
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.lineTo(x3, y3);
                ctx.closePath();
            }
            ctx.stroke();
            
            ctx.fillStyle = "#ffffff";
            ctx.font = "11px Share Tech Mono";
            ctx.textAlign = "center";
            ctx.fillText(`CUSTOM STL MESH (${mesh.length} Triangles)`, w/2, h - 15);
            return;
        }

        ctx.fillStyle = "#0c0f12";
        ctx.fillRect(0, 0, w, h);

        const cx = w / 2;
        const cy = h / 2 + 30;
        
        const scale = 220 / (this.geom.outerRadius * 2);

        const sod = this.settings.sod;
        const sfd = this.settings.sfd;
        const sourceY = cy - sod * scale;
        const detectorY = cy + (sfd - sod) * scale;
        const detHalfW = 210 * scale;

        ctx.strokeStyle = "rgba(0, 240, 255, 0.15)";
        ctx.fillStyle = "rgba(0, 240, 255, 0.03)";
        ctx.beginPath();
        ctx.moveTo(cx, sourceY);
        ctx.lineTo(cx - detHalfW, detectorY);
        ctx.lineTo(cx + detHalfW, detectorY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = "#ff6c00";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx - detHalfW, detectorY);
        ctx.lineTo(cx + detHalfW, detectorY);
        ctx.stroke();
        ctx.lineWidth = 1;

        ctx.fillStyle = "#2c3e50";
        ctx.beginPath();
        ctx.arc(cx, cy, this.geom.outerRadius * scale, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = "#111115";
        ctx.beginPath();
        ctx.arc(cx, cy, (this.geom.outerRadius - this.geom.casingThickness) * scale, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = "#8e44ad";
        ctx.beginPath();
        ctx.arc(cx, cy, this.geom.propellantRadius * scale, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = "#0c0f12";
        if (this.geom.boreType === "cylindrical") {
            ctx.beginPath();
            ctx.arc(cx, cy, this.geom.boreRadius * scale, 0, 2 * Math.PI);
            ctx.fill();
        } else {
            ctx.beginPath();
            const pts = this.geom.starPoints * 2;
            for (let i = 0; i <= pts; i++) {
                const angle = (i * Math.PI * 2) / pts;
                const isTip = i % 2 === 0;
                const r = isTip ? 
                    this.geom.boreRadius * (1.0 + this.geom.starDepth) : 
                    this.geom.boreRadius * (1.0 - this.geom.starDepth);
                const px = cx + Math.cos(angle) * r * scale;
                const py = cy + Math.sin(angle) * r * scale;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
        }

        if (this.defect.active) {
            ctx.save();
            ctx.translate(cx + this.defect.x * scale, cy + this.defect.y * scale);
            ctx.rotate(this.defect.angle * Math.PI / 180);
            
            if (this.defect.type === "crack") {
                ctx.fillStyle = "rgba(255, 0, 0, 0.6)";
                ctx.strokeStyle = "#ff0000";
            } else if (this.defect.type === "inclusion") {
                ctx.fillStyle = "rgba(255, 255, 0, 0.7)";
                ctx.strokeStyle = "#ffff00";
            } else {
                ctx.fillStyle = "rgba(255, 120, 0, 0.6)";
                ctx.strokeStyle = "#ff7800";
            }

            ctx.beginPath();
            ctx.ellipse(0, 0, this.defect.rx * scale, this.defect.ry * scale, 0, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }

        ctx.fillStyle = "#00f0ff";
        ctx.beginPath();
        ctx.arc(cx, sourceY, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "10px Share Tech Mono";
        ctx.fillText("X-RAY SOURCE", cx + 10, sourceY + 3);

        ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
        ctx.beginPath();
        ctx.moveTo(0, cy); ctx.lineTo(w, cy);
        ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
        ctx.stroke();
    }

    addBoxToMesh(triangles, x1, x2, y1, y2, z1, z2) {
        const p000 = {x: x1, y: y1, z: z1};
        const p100 = {x: x2, y: y1, z: z1};
        const p010 = {x: x1, y: y2, z: z1};
        const p110 = {x: x2, y: y2, z: z1};
        const p001 = {x: x1, y: y1, z: z2};
        const p101 = {x: x2, y: y1, z: z2};
        const p011 = {x: x1, y: y2, z: z2};
        const p111 = {x: x2, y: y2, z: z2};
        
        const addTri = (v1, v2, v3) => {
            const ux = v2.x - v1.x, uy = v2.y - v1.y, uz = v2.z - v1.z;
            const vx = v3.x - v1.x, vy = v3.y - v1.y, vz = v3.z - v1.z;
            const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
            const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
            triangles.push({
                v1, v2, v3,
                normal: { x: nx/len, y: ny/len, z: nz/len }
            });
        };
        
        addTri(p000, p010, p100);
        addTri(p100, p010, p110);
        addTri(p101, p111, p001);
        addTri(p001, p111, p011);
        addTri(p001, p011, p000);
        addTri(p000, p011, p010);
        addTri(p100, p110, p101);
        addTri(p101, p110, p111);
        addTri(p001, p000, p101);
        addTri(p101, p000, p100);
        addTri(p010, p011, p110);
        addTri(p110, p011, p111);
    }

    addCylinderToMesh(triangles, rInner, rOuter, z1, z2, sectors) {
        const addTri = (v1, v2, v3) => {
            const ux = v2.x - v1.x, uy = v2.y - v1.y, uz = v2.z - v1.z;
            const vx = v3.x - v1.x, vy = v3.y - v1.y, vz = v3.z - v1.z;
            const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
            const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
            triangles.push({
                v1, v2, v3,
                normal: { x: nx/len, y: ny/len, z: nz/len }
            });
        };
        
        for (let i = 0; i < sectors; i++) {
            const theta1 = (i * Math.PI * 2) / sectors;
            const theta2 = ((i + 1) * Math.PI * 2) / sectors;
            const cos1 = Math.cos(theta1), sin1 = Math.sin(theta1);
            const cos2 = Math.cos(theta2), sin2 = Math.sin(theta2);
            
            const po1_z1 = { x: rOuter * cos1, y: rOuter * sin1, z: z1 };
            const po2_z1 = { x: rOuter * cos2, y: rOuter * sin2, z: z1 };
            const po1_z2 = { x: rOuter * cos1, y: rOuter * sin1, z: z2 };
            const po2_z2 = { x: rOuter * cos2, y: rOuter * sin2, z: z2 };
            
            const pi1_z1 = { x: rInner * cos1, y: rInner * sin1, z: z1 };
            const pi2_z1 = { x: rInner * cos2, y: rInner * sin2, z: z1 };
            const pi1_z2 = { x: rInner * cos1, y: rInner * sin1, z: z2 };
            const pi2_z2 = { x: rInner * cos2, y: rInner * sin2, z: z2 };
            
            addTri(po1_z1, po2_z1, po1_z2);
            addTri(po2_z1, po2_z2, po1_z2);
            
            if (rInner > 0) {
                addTri(pi1_z1, pi1_z2, pi2_z1);
                addTri(pi2_z1, pi1_z2, pi2_z2);
            }
            
            if (rInner > 0) {
                addTri(po1_z1, pi1_z1, po2_z1);
                addTri(po2_z1, pi1_z1, pi2_z1);
            } else {
                addTri(po1_z1, {x:0, y:0, z:z1}, po2_z1);
            }
            
            if (rInner > 0) {
                addTri(po1_z2, po2_z2, pi1_z2);
                addTri(po2_z2, pi2_z2, pi1_z2);
            } else {
                addTri(po1_z2, po2_z2, {x:0, y:0, z:z2});
            }
        }
    }

    generateStepWedge() {
        const triangles = [];
        this.addBoxToMesh(triangles, -100, -60, -5, 5, -100, 100);
        this.addBoxToMesh(triangles, -60, -20, -12.5, 12.5, -100, 100);
        this.addBoxToMesh(triangles, -20, 20, -25, 25, -100, 100);
        this.addBoxToMesh(triangles, 20, 60, -40, 40, -100, 100);
        this.addBoxToMesh(triangles, 60, 100, -60, 60, -100, 100);
        return triangles;
    }

    generateWeldedPipe() {
        const triangles = [];
        this.addCylinderToMesh(triangles, 60, 75, -100, -10, 32);
        this.addCylinderToMesh(triangles, 60, 82, -10, 10, 32);
        this.addCylinderToMesh(triangles, 60, 75, 10, 100, 32);
        return triangles;
    }

    generateFlangedCoupler() {
        const triangles = [];
        this.addCylinderToMesh(triangles, 0, 40, -120, -20, 32);
        this.addCylinderToMesh(triangles, 0, 90, -20, 20, 32);
        this.addCylinderToMesh(triangles, 0, 40, 20, 120, 32);
        return triangles;
    }
}

window.SRMSimulator = SRMSimulator;
