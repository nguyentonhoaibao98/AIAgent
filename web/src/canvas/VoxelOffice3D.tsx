import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Box, Eye, RotateCcw, Smartphone } from "lucide-react";
import type { AgentInfo, DeviceInfo, HandoffBeam, OfficeZone, TestCase } from "@maestro-office/shared";

interface Props {
  agents: AgentInfo[];
  devices: DeviceInfo[];
  testCases: TestCase[];
  beams: HandoffBeam[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
}

interface Vec2 {
  x: number;
  z: number;
}

interface VoxelAgentRig {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Group;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  selectRing: THREE.Mesh;
  alertRing: THREE.Mesh;
  zone: OfficeZone;
  waypoints: Vec2[];
}

interface ProjectedOverlay {
  id: string;
  shortName: string;
  role: AgentInfo["role"];
  status: AgentInfo["status"];
  speech: string;
  x: number;
  y: number;
  visible: boolean;
  progress: number;
}

// 3D World coordinate mapping (Office spans x: -12..12, z: -7..7)
const CORRIDOR_HUB: Vec2 = { x: -2.2, z: 1.6 };
const DOORWAYS: Record<OfficeZone, Vec2> = {
  planning: { x: -4.2, z: 0.6 },
  automation: { x: -0.6, z: 0.6 },
  device_lab: { x: -4.2, z: 2.6 },
  lounge: { x: 1.4, z: 2.6 }
};

const PLANNING_DESK: Vec2 = { x: -7.5, z: -2.6 };

const AUTOMATION_DESKS: Vec2[] = [
  { x: 0.2, z: -4.8 },
  { x: 4.5, z: -4.8 },
  { x: 8.8, z: -4.8 },
  { x: 0.2, z: -2.2 },
  { x: 4.5, z: -2.2 },
  { x: 8.8, z: -2.2 },
  { x: 0.2, z: 0.3 },
  { x: 4.5, z: 0.3 },
  { x: 8.8, z: 0.3 }
];

const DEVICE_SLOTS: Vec2[] = [
  { x: -9.4, z: 4.2 },
  { x: -6.4, z: 4.2 },
  { x: -3.4, z: 4.2 }
];

const DEVICE_QUEUE_SPOTS: Vec2[] = [
  { x: -9.8, z: 5.8 },
  { x: -8.0, z: 5.8 },
  { x: -6.2, z: 5.8 },
  { x: -4.4, z: 5.8 },
  { x: -2.6, z: 5.8 },
  { x: -1.4, z: 5.8 }
];

const LOUNGE_SPOTS: Vec2[] = [
  { x: 1.4, z: 4.1 },
  { x: 3.1, z: 4.1 },
  { x: 4.8, z: 4.1 },
  { x: 6.5, z: 4.1 },
  { x: 8.2, z: 4.1 },
  { x: 9.7, z: 4.1 },
  { x: 2.2, z: 5.8 },
  { x: 4.4, z: 5.8 },
  { x: 6.6, z: 5.8 },
  { x: 8.8, z: 5.8 }
];

function getTargetPos(agent: AgentInfo, devices: DeviceInfo[], allAgents: AgentInfo[]): Vec2 {
  if (agent.zone === "planning") return PLANNING_DESK;
  if (agent.zone === "automation") {
    const idx = Math.max(0, Math.min(8, agent.deskIndex - 1));
    return AUTOMATION_DESKS[idx];
  }
  if (agent.zone === "device_lab") {
    const lockedIdx = devices.findIndex((d) => d.lockedByAgentId === agent.id);
    if (lockedIdx >= 0) return DEVICE_SLOTS[lockedIdx % DEVICE_SLOTS.length];
    const waiting = allAgents.filter((a) => a.status === "waiting_device");
    const qIdx = Math.max(0, waiting.findIndex((a) => a.id === agent.id));
    return DEVICE_QUEUE_SPOTS[qIdx % DEVICE_QUEUE_SPOTS.length];
  }
  return LOUNGE_SPOTS[agent.deskIndex % LOUNGE_SPOTS.length];
}

function statusHex(status: AgentInfo["status"]): number {
  switch (status) {
    case "analyzing":
    case "handoff":
      return 0xf59e0b;
    case "writing":
      return 0x38bdf8;
    case "testing":
      return 0x22c55e;
    case "debugging":
      return 0xf97316;
    case "waiting_device":
      return 0xeab308;
    case "error":
      return 0xef4444;
    case "done":
      return 0x10b981;
    default:
      return 0x334155;
  }
}

function statusBorderCss(status: AgentInfo["status"]): string {
  switch (status) {
    case "analyzing":
    case "handoff":
      return "border-amber-400";
    case "writing":
      return "border-sky-400";
    case "testing":
      return "border-emerald-400";
    case "debugging":
      return "border-orange-400";
    case "waiting_device":
      return "border-yellow-400";
    case "error":
      return "border-rose-500";
    case "done":
      return "border-emerald-500";
    default:
      return "border-slate-600";
  }
}

export const VoxelOffice3D: React.FC<Props> = ({
  agents,
  devices,
  testCases,
  beams,
  selectedAgentId,
  onSelectAgent
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const stateRef = useRef({ agents, devices, testCases, beams, selectedAgentId });
  stateRef.current = { agents, devices, testCases, beams, selectedAgentId };

  const [overlays, setOverlays] = useState<ProjectedOverlay[]>([]);
  const [webglError, setWebglError] = useState<string | null>(null);

  const setCameraPreset = (preset: "iso" | "top" | "lab") => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;
    if (preset === "iso") {
      cam.position.set(0, 15.5, 16.5);
      ctrl.target.set(0, 0, 0.4);
    } else if (preset === "top") {
      cam.position.set(0, 22, 3.2);
      ctrl.target.set(0, 0, 0.3);
    } else if (preset === "lab") {
      cam.position.set(-6.2, 8.5, 11.2);
      ctrl.target.set(-6.4, 0.5, 4.0);
    }
    ctrl.update();
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      setWebglError("WebGL không khả dụng trên trình duyệt này. Hãy chuyển sang chế độ 2D Pixel.");
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth || 960, 520);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070c18);
    scene.fog = new THREE.Fog(0x070c18, 28, 52);

    const camera = new THREE.PerspectiveCamera(38, (container.clientWidth || 960) / 520, 0.1, 100);
    camera.position.set(0, 15.5, 16.5);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.25;
    controls.minDistance = 8;
    controls.maxDistance = 32;
    controls.target.set(0, 0, 0.4);
    controls.update();
    controlsRef.current = controls;

    // --- LIGHTING ---
    const ambient = new THREE.AmbientLight(0xcbd5e1, 0.72);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfffbeb, 1.35);
    sun.position.set(10, 22, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    // Subtle colored zone glow lights
    const addZoneLight = (color: number, x: number, y: number, z: number, intensity = 1.2) => {
      const l = new THREE.PointLight(color, intensity, 13, 1.5);
      l.position.set(x, y, z);
      scene.add(l);
    };
    addZoneLight(0xf59e0b, -7.5, 4, -2.5, 1.3);
    addZoneLight(0x38bdf8, 4.5, 4.5, -2.2, 1.4);
    addZoneLight(0x22c55e, -6.4, 3.8, 4.4, 1.3);
    addZoneLight(0xa78bfa, 5.5, 3.8, 4.6, 1.2);

    // --- BASE OFFICE FLOOR ---
    const baseGeo = new THREE.BoxGeometry(24.6, 0.4, 14.8);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
    const baseFloor = new THREE.Mesh(baseGeo, baseMat);
    baseFloor.position.set(0, -0.2, 0.2);
    baseFloor.receiveShadow = true;
    scene.add(baseFloor);

    // Subtle pixel grid helper
    const grid = new THREE.GridHelper(24, 24, 0x1e293b, 0x141d30);
    grid.position.set(0, 0.01, 0.2);
    scene.add(grid);

    // --- 4 ROOM FLOOR PADS & ACCENT TRIMS ---
    addRoomPad(scene, -7.4, -2.4, 8.2, 7.6, 0x1e293b, 0xf59e0b); // Planning Room
    addRoomPad(scene, 4.4, -2.4, 14.0, 7.6, 0x162238, 0x38bdf8); // Automation Wing
    addRoomPad(scene, -6.2, 4.4, 10.6, 4.6, 0x11252e, 0x22c55e); // Device Lab
    addRoomPad(scene, 5.6, 4.4, 11.6, 4.6, 0x1f1a33, 0xa78bfa); // Coffee Lounge

    // Low glass partition walls between rooms (with doorway gaps)
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      transparent: true,
      opacity: 0.45,
      roughness: 0.3
    });
    const addWall = (x: number, z: number, w: number, d: number, h = 1.4) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      scene.add(m);
    };
    // Vertical divider between Planning & Automation
    addWall(-3.0, -3.2, 0.16, 5.8, 1.5);
    // Horizontal divider top/bottom (leaving doorway gaps)
    addWall(-8.0, 1.55, 6.4, 0.16, 1.2);
    addWall(6.2, 1.55, 10.4, 0.16, 1.2);
    // Vertical divider between Device Lab & Lounge
    addWall(-0.6, 4.5, 0.16, 4.2, 1.2);

    // --- FURNITURE: PLANNING ROOM ---
    const leadMonitorMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.3
    });
    addWorkstation(scene, PLANNING_DESK.x, PLANNING_DESK.z - 0.9, 0x78350f, leadMonitorMat, true);
    addWhiteboard(scene, -9.2, -5.6);
    addBookshelf(scene, -5.2, -5.6);
    addVoxelPlant(scene, -10.8, 0.6);

    // --- FURNITURE: 9 AUTOMATION WORKSTATIONS ---
    const engMonitorMats: THREE.MeshStandardMaterial[] = [];
    AUTOMATION_DESKS.forEach((pos) => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        emissive: 0x1e293b,
        emissiveIntensity: 0.25
      });
      engMonitorMats.push(mat);
      addWorkstation(scene, pos.x, pos.z - 0.85, 0x334155, mat, false);
    });
    addVoxelPlant(scene, 10.6, -5.4);
    addVoxelPlant(scene, 10.6, 0.6);

    // --- FURNITURE: DEVICE LAB (3 Phone Racks + Blinking Server Rack) ---
    const phoneScreenMats: THREE.MeshStandardMaterial[] = [];
    DEVICE_SLOTS.forEach((slot) => {
      const screenMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        emissive: 0x0f172a,
        emissiveIntensity: 0.4
      });
      phoneScreenMats.push(screenMat);
      addDeviceStand(scene, slot.x, slot.z - 0.85, screenMat);
    });
    const serverLeds = addServerRack(scene, -1.6, 3.6);

    // --- FURNITURE: COFFEE LOUNGE ---
    addSofa(scene, 4.2, 2.8);
    const steamCubes = addCoffeeBar(scene, 10.2, 4.4);
    addVoxelPlant(scene, 0.6, 6.0);

    // --- 10 VOXEL AGENT RIGS ---
    const rigs = new Map<string, VoxelAgentRig>();
    const clickableMeshes: THREE.Object3D[] = [];

    const ensureAgentRig = (agent: AgentInfo) => {
      if (rigs.has(agent.id)) return rigs.get(agent.id)!;
      const target = getTargetPos(agent, stateRef.current.devices, stateRef.current.agents);
      const rig = createVoxelAgent(agent);
      rig.group.position.set(target.x, 0, target.z);
      rig.zone = agent.zone;
      rig.group.userData.agentId = agent.id;
      rig.group.traverse((obj) => {
        obj.userData.agentId = agent.id;
      });
      scene.add(rig.group);
      clickableMeshes.push(rig.group);
      rigs.set(agent.id, rig);
      return rig;
    };

    // --- HANDOFF BEAM POOL ---
    const beamGroup = new THREE.Group();
    scene.add(beamGroup);
    const beamMeshes = new Map<string, { line: THREE.Line; packet: THREE.Mesh }>();

    // --- RAYCASTER FOR CLICKING 3D AGENTS ---
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(clickableMeshes, true);
      if (hits.length > 0) {
        const id = hits[0].object.userData.agentId as string | undefined;
        if (id) onSelectAgent(id);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    // --- RESIZE OBSERVER ---
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth || 960;
      const h = 520;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    // --- ANIMATION LOOP ---
    let rafId = 0;
    let lastOverlaySync = 0;
    const projVec = new THREE.Vector3();

    const animate = (timeMs: number) => {
      const t = timeMs / 1000;
      const { agents: curAgents, devices: curDevices, testCases: curCases, beams: curBeams, selectedAgentId: selId } =
        stateRef.current;

      // Update server rack blinking LEDs
      serverLeds.forEach((mat, idx) => {
        const on = Math.floor(t * 3 + idx) % 2 === 0;
        mat.emissive.setHex(on ? 0x22c55e : 0x0284c7);
        mat.emissiveIntensity = on ? 1.2 : 0.4;
      });

      // Animate coffee steam voxels
      steamCubes.forEach((cube, idx) => {
        const phase = (t * 0.9 + idx * 0.35) % 1;
        cube.position.y = 1.6 + phase * 1.1;
        cube.scale.setScalar(1 - phase * 0.6);
        (cube.material as THREE.MeshStandardMaterial).opacity = (1 - phase) * 0.65;
      });

      // Update Device Lab phone screens
      phoneScreenMats.forEach((mat, idx) => {
        const dev = curDevices[idx];
        if (!dev) {
          mat.emissive.setHex(0x0f172a);
          mat.emissiveIntensity = 0.2;
        } else if (dev.lockedByAgentId) {
          mat.emissive.setHex(0x22c55e);
          mat.emissiveIntensity = 0.8 + Math.sin(t * 6) * 0.3;
        } else {
          mat.emissive.setHex(0x0ea5e9);
          mat.emissiveIntensity = 0.35;
        }
      });

      // Update 10 Voxel Agents
      curAgents.forEach((agent) => {
        const rig = ensureAgentRig(agent);
        const target = getTargetPos(agent, curDevices, curAgents);

        // Update desk monitor glow
        const monColor = statusHex(agent.status);
        if (agent.id === "qa-lead") {
          leadMonitorMat.emissive.setHex(agent.zone === "planning" ? monColor : 0x1e293b);
          leadMonitorMat.emissiveIntensity = agent.zone === "planning" ? 0.85 : 0.15;
        } else if (agent.deskIndex >= 1 && agent.deskIndex <= 9) {
          const m = engMonitorMats[agent.deskIndex - 1];
          if (m) {
            m.emissive.setHex(agent.zone === "automation" ? monColor : 0x1e293b);
            m.emissiveIntensity = agent.zone === "automation" ? 0.85 : 0.15;
          }
        }

        // Waypoint pathfinding across rooms
        if (rig.zone !== agent.zone) {
          rig.waypoints = [DOORWAYS[rig.zone], CORRIDOR_HUB, DOORWAYS[agent.zone], target];
          rig.zone = agent.zone;
        } else if (rig.waypoints.length === 0) {
          if (Math.hypot(target.x - rig.group.position.x, target.z - rig.group.position.z) > 0.12) {
            rig.waypoints = [target];
          }
        } else {
          rig.waypoints[rig.waypoints.length - 1] = target;
        }

        let walking = false;
        if (rig.waypoints.length > 0) {
          const next = rig.waypoints[0];
          const dx = next.x - rig.group.position.x;
          const dz = next.z - rig.group.position.z;
          const dist = Math.hypot(dx, dz);
          const step = 0.14;
          if (dist <= step) {
            rig.group.position.x = next.x;
            rig.group.position.z = next.z;
            rig.waypoints.shift();
          } else {
            rig.group.position.x += (dx / dist) * step;
            rig.group.position.z += (dz / dist) * step;
            rig.group.rotation.y = Math.atan2(dx, dz);
            walking = true;
          }
        } else {
          // Face monitor when at desk or device lab; face forward in lounge
          const desiredRot = agent.zone === "lounge" ? 0 : Math.PI;
          rig.group.rotation.y += (desiredRot - rig.group.rotation.y) * 0.12;
        }

        // Character limb & body animations
        if (walking) {
          const swing = Math.sin(t * 14) * 0.55;
          rig.leftLeg.rotation.x = swing;
          rig.rightLeg.rotation.x = -swing;
          rig.leftArm.rotation.x = -swing * 0.8;
          rig.rightArm.rotation.x = swing * 0.8;
          rig.group.position.y = Math.abs(Math.sin(t * 14)) * 0.08;
        } else if (agent.status === "writing" || agent.status === "testing" || agent.status === "debugging" || agent.status === "analyzing") {
          rig.leftLeg.rotation.x = 0;
          rig.rightLeg.rotation.x = 0;
          rig.leftArm.rotation.x = -0.8 + Math.sin(t * 18) * 0.22;
          rig.rightArm.rotation.x = -0.8 - Math.sin(t * 18) * 0.22;
          rig.group.position.y = 0;
        } else {
          rig.leftLeg.rotation.x = 0;
          rig.rightLeg.rotation.x = 0;
          rig.leftArm.rotation.x = 0;
          rig.rightArm.rotation.x = 0;
          rig.group.position.y = Math.sin(t * 2.5 + agent.deskIndex) * 0.03;
        }

        // Selection ring & Alert beacon ring
        rig.selectRing.visible = selId === agent.id;
        const isAlert = agent.status === "debugging" || agent.status === "error";
        rig.alertRing.visible = isAlert;
        if (isAlert) {
          const pulse = 1 + Math.sin(t * 8) * 0.25;
          rig.alertRing.scale.set(pulse, pulse, 1);
          (rig.alertRing.material as THREE.MeshBasicMaterial).color.setHex(
            agent.status === "error" ? 0xef4444 : 0xf97316
          );
        }
      });

      // Update 3D Handoff Beams (golden voxel packets arcing from QA Lead -> 9 Engineers)
      const now = Date.now();
      const activeBeamIds = new Set(curBeams.map((b) => b.id));
      for (const [id, item] of beamMeshes.entries()) {
        if (!activeBeamIds.has(id)) {
          beamGroup.remove(item.line);
          beamGroup.remove(item.packet);
          item.line.geometry.dispose();
          beamMeshes.delete(id);
        }
      }
      curBeams.forEach((b) => {
        const fromRig = rigs.get(b.fromAgentId);
        const toRig = rigs.get(b.toAgentId);
        if (!fromRig || !toRig) return;
        const p0 = new THREE.Vector3(fromRig.group.position.x, 1.5, fromRig.group.position.z);
        const p2 = new THREE.Vector3(toRig.group.position.x, 1.5, toRig.group.position.z);
        const mid = p0.clone().lerp(p2, 0.5);
        mid.y += 3.2;
        const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);
        const progress = Math.min(1, (now - b.createdAt) / 1500);

        let entry = beamMeshes.get(b.id);
        if (!entry) {
          const pts = curve.getPoints(24);
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          const mat = new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.7 });
          const line = new THREE.Line(geo, mat);
          const packet = new THREE.Mesh(
            new THREE.BoxGeometry(0.35, 0.25, 0.35),
            new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xf59e0b, emissiveIntensity: 0.9 })
          );
          beamGroup.add(line);
          beamGroup.add(packet);
          entry = { line, packet };
          beamMeshes.set(b.id, entry);
        }
        const pt = curve.getPoint(progress);
        entry.packet.position.copy(pt);
        entry.packet.rotation.y += 0.12;
      });

      controls.update();
      renderer.render(scene, camera);

      // Project crisp HTML labels & speech bubbles every ~65ms (15fps UI sync, 60fps 3D)
      if (timeMs - lastOverlaySync > 65) {
        lastOverlaySync = timeMs;
        const w = renderer.domElement.clientWidth;
        const h = renderer.domElement.clientHeight;
        const nextOverlays: ProjectedOverlay[] = curAgents.map((a) => {
          const rig = rigs.get(a.id);
          if (!rig) {
            return {
              id: a.id,
              shortName: a.shortName,
              role: a.role,
              status: a.status,
              speech: a.speech,
              x: 0,
              y: 0,
              visible: false,
              progress: 0
            };
          }
          projVec.set(rig.group.position.x, 2.25, rig.group.position.z);
          projVec.project(camera);
          const sx = (projVec.x * 0.5 + 0.5) * w;
          const sy = (-projVec.y * 0.5 + 0.5) * h;
          const myCases = curCases.filter((c) => c.assignedAgentId === a.id);
          const passedCases = myCases.filter((c) => c.status === "passed").length;
          const progress = myCases.length > 0 ? passedCases / myCases.length : a.status === "done" ? 1 : 0;

          return {
            id: a.id,
            shortName: a.shortName,
            role: a.role,
            status: a.status,
            speech: a.speech,
            x: sx,
            y: sy,
            visible: projVec.z < 1 && sx > 10 && sx < w - 10 && sy > 10 && sy < h - 10,
            progress
          };
        });
        setOverlays(nextOverlays);
      }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      renderer.dispose();
    };
  }, [onSelectAgent]);

  if (webglError) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-sm text-amber-300">
        {webglError}
      </div>
    );
  }

  return (
    <div className="relative h-[520px] w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-2xl">
      {/* 3D WebGL Viewport */}
      <div ref={containerRef} className="h-full w-full cursor-grab active:cursor-grabbing" />

      {/* Room Legend Overlay (Top-Left) */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5 font-mono text-[10px]">
        <span className="rounded border border-amber-500/40 bg-slate-950/80 px-2 py-0.5 text-amber-300">
          Planning (Agent 01)
        </span>
        <span className="rounded border border-sky-500/40 bg-slate-950/80 px-2 py-0.5 text-sky-300">
          Automation Wing (9 Eng)
        </span>
        <span className="rounded border border-emerald-500/40 bg-slate-950/80 px-2 py-0.5 text-emerald-300">
          Device Lab (ADB Queue)
        </span>
        <span className="rounded border border-violet-500/40 bg-slate-950/80 px-2 py-0.5 text-violet-300">
          Coffee Lounge
        </span>
      </div>

      {/* Camera Preset Controls (Top-Right) */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900/90 p-1 backdrop-blur-xs">
        <button
          onClick={() => setCameraPreset("iso")}
          className="inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] text-slate-200 hover:bg-slate-800"
          title="Góc nhìn Isometric 3D"
        >
          <Box className="h-3 w-3 text-sky-400" /> Iso
        </button>
        <button
          onClick={() => setCameraPreset("top")}
          className="inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] text-slate-200 hover:bg-slate-800"
          title="Nhìn từ trên xuống"
        >
          <Eye className="h-3 w-3 text-amber-400" /> Top
        </button>
        <button
          onClick={() => setCameraPreset("lab")}
          className="inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] text-slate-200 hover:bg-slate-800"
          title="Zoom vào Device Lab"
        >
          <Smartphone className="h-3 w-3 text-emerald-400" /> Lab
        </button>
        <button
          onClick={() => setCameraPreset("iso")}
          className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
          title="Reset camera"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>

      {/* Hint footer */}
      <div className="pointer-events-none absolute bottom-2 left-3 rounded bg-slate-950/75 px-2 py-0.5 font-mono text-[10px] text-slate-400">
        Kéo chuột để xoay 3D · Cuộn để Zoom · Click nhân vật để kiểm tra
      </div>

      {/* Crisp Projected HTML Name Tags & Speech Bubbles */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {overlays.map((o) => {
          if (!o.visible) return null;
          const isSelected = o.id === selectedAgentId;
          const showSpeech = o.speech && o.status !== "idle" && (o.status !== "done" || isSelected);
          return (
            <div
              key={o.id}
              style={{ transform: `translate(-50%, -100%) translate(${o.x}px, ${o.y}px)` }}
              className="absolute left-0 top-0 flex flex-col items-center gap-0.5"
            >
              {showSpeech && (
                <div
                  className={`max-w-[175px] truncate rounded border bg-slate-950/92 px-1.5 py-0.5 font-mono text-[9px] text-slate-100 shadow-lg ${statusBorderCss(o.status)}`}
                >
                  {o.speech}
                </div>
              )}
              <div
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold shadow ${
                  isSelected
                    ? "bg-sky-500 text-slate-950"
                    : o.role === "qa_lead"
                      ? "bg-slate-950/85 text-amber-300"
                      : "bg-slate-950/85 text-slate-200"
                }`}
              >
                {o.shortName}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// --- VOXEL SCENE BUILDER HELPERS ---

function addRoomPad(
  scene: THREE.Scene,
  x: number,
  z: number,
  w: number,
  d: number,
  color: number,
  accent: number
) {
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.14, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
  );
  pad.position.set(x, 0.07, z);
  pad.receiveShadow = true;
  scene.add(pad);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.16, 0.12),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.45 })
  );
  trim.position.set(x, 0.08, z - d / 2 + 0.06);
  scene.add(trim);
}

function addWorkstation(
  scene: THREE.Scene,
  x: number,
  z: number,
  woodColor: number,
  monitorScreenMat: THREE.MeshStandardMaterial,
  isLead: boolean
) {
  const g = new THREE.Group();
  const w = isLead ? 2.4 : 1.9;
  const deskTop = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.14, 0.95),
    new THREE.MeshStandardMaterial({ color: woodColor, roughness: 0.7 })
  );
  deskTop.position.set(0, 0.82, 0);
  deskTop.castShadow = true;
  deskTop.receiveShadow = true;
  g.add(deskTop);

  const legMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
  [-w / 2 + 0.12, w / 2 - 0.12].forEach((lx) => {
    [-0.36, 0.36].forEach((lz) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), legMat);
      leg.position.set(lx, 0.4, lz);
      leg.castShadow = true;
      g.add(leg);
    });
  });

  // Voxel Monitor
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.25, 0.16), legMat);
  stand.position.set(0, 1.0, -0.15);
  g.add(stand);

  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.58, 0.08), legMat);
  bezel.position.set(0, 1.32, -0.15);
  bezel.castShadow = true;
  g.add(bezel);

  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.46, 0.02), monitorScreenMat);
  screen.position.set(0, 1.32, -0.1);
  g.add(screen);

  // Voxel Keyboard
  const kb = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.2), new THREE.MeshStandardMaterial({ color: 0x475569 }));
  kb.position.set(0, 0.91, 0.22);
  g.add(kb);

  // Voxel Chair
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: 0x334155 }));
  seat.position.set(0, 0.46, 0.85);
  seat.castShadow = true;
  g.add(seat);

  g.position.set(x, 0, z);
  scene.add(g);
}

function addWhiteboard(scene: THREE.Scene, x: number, z: number) {
  const g = new THREE.Group();
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 1.4, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 })
  );
  board.position.set(0, 1.5, 0);
  board.castShadow = true;
  g.add(board);

  [
    { c: 0x0284c7, y: 1.8, w: 1.0 },
    { c: 0xf59e0b, y: 1.5, w: 1.6 },
    { c: 0x10b981, y: 1.2, w: 1.2 }
  ].forEach((bar) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(bar.w, 0.14, 0.04),
      new THREE.MeshStandardMaterial({ color: bar.c })
    );
    m.position.set(-0.9 + bar.w / 2, bar.y, 0.08);
    g.add(m);
  });

  g.position.set(x, 0, z);
  scene.add(g);
}

function addBookshelf(scene: THREE.Scene, x: number, z: number) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 2.0, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.85 })
  );
  frame.position.set(0, 1.0, 0);
  frame.castShadow = true;
  g.add(frame);

  const colors = [0xef4444, 0x38bdf8, 0xf59e0b, 0x22c55e, 0xa78bfa, 0xfb7185];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 6; i++) {
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.42, 0.4),
        new THREE.MeshStandardMaterial({ color: colors[(row * 3 + i) % colors.length] })
      );
      book.position.set(-0.75 + i * 0.3, 0.45 + row * 0.56, 0.12);
      g.add(book);
    }
  }
  g.position.set(x, 0, z);
  scene.add(g);
}

function addVoxelPlant(scene: THREE.Scene, x: number, z: number) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.5, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.8 })
  );
  pot.position.y = 0.25;
  pot.castShadow = true;
  g.add(pot);

  const leaf1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.82, 0.55, 0.82),
    new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.7 })
  );
  leaf1.position.y = 0.75;
  leaf1.castShadow = true;
  g.add(leaf1);

  const leaf2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.45, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.7 })
  );
  leaf2.position.y = 1.18;
  leaf2.castShadow = true;
  g.add(leaf2);

  g.position.set(x, 0, z);
  scene.add(g);
}

function addDeviceStand(scene: THREE.Scene, x: number, z: number, screenMat: THREE.MeshStandardMaterial) {
  const g = new THREE.Group();
  const pedestal = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.9, 1.0),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 })
  );
  pedestal.position.y = 0.45;
  pedestal.castShadow = true;
  g.add(pedestal);

  // Voxel Smartphone on stand
  const phoneBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.96, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3 })
  );
  phoneBody.position.set(0, 1.38, 0);
  phoneBody.rotation.x = -0.25;
  phoneBody.castShadow = true;
  g.add(phoneBody);

  const phoneScreen = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.8, 0.03), screenMat);
  phoneScreen.position.set(0, 1.38, 0.04);
  phoneScreen.rotation.x = -0.25;
  g.add(phoneScreen);

  g.position.set(x, 0, z);
  scene.add(g);
}

function addServerRack(scene: THREE.Scene, x: number, z: number): THREE.MeshStandardMaterial[] {
  const g = new THREE.Group();
  const cabinet = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 2.2, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 })
  );
  cabinet.position.y = 1.1;
  cabinet.castShadow = true;
  g.add(cabinet);

  const ledMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 5; i++) {
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 0.8 });
    ledMats.push(ledMat);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.05), ledMat);
    led.position.set(-0.28, 0.45 + i * 0.36, 0.46);
    g.add(led);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  return ledMats;
}

function addSofa(scene: THREE.Scene, x: number, z: number) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x5b21b6, roughness: 0.85 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.48, 1.1), mat);
  base.position.y = 0.24;
  base.castShadow = true;
  g.add(base);

  const back = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.72, 0.28), new THREE.MeshStandardMaterial({ color: 0x6d28d9 }));
  back.position.set(0, 0.65, -0.41);
  back.castShadow = true;
  g.add(back);

  g.position.set(x, 0, z);
  scene.add(g);
}

function addCoffeeBar(scene: THREE.Scene, x: number, z: number): THREE.Mesh[] {
  const g = new THREE.Group();
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.0, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.75 })
  );
  counter.position.y = 0.5;
  counter.castShadow = true;
  g.add(counter);

  const machine = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.55, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.4, roughness: 0.4 })
  );
  machine.position.set(0, 1.28, -0.3);
  machine.castShadow = true;
  g.add(machine);

  const steamCubes: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.14),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.55 })
    );
    cube.position.set(x, 1.6 + i * 0.3, z - 0.3);
    scene.add(cube);
    steamCubes.push(cube);
  }

  g.position.set(x, 0, z);
  scene.add(g);
  return steamCubes;
}

function createVoxelAgent(agent: AgentInfo): VoxelAgentRig {
  const group = new THREE.Group();

  const legMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.52, 0.24), legMat);
  leftLeg.position.set(-0.14, 0.26, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.52, 0.24), legMat);
  rightLeg.position.set(0.14, 0.26, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  const shirtMat = new THREE.MeshStandardMaterial({ color: agent.shirtColor, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.64, 0.36), shirtMat);
  body.position.set(0, 0.84, 0);
  body.castShadow = true;
  group.add(body);

  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.54, 0.2), shirtMat);
  leftArm.position.set(-0.42, 0.86, 0);
  leftArm.castShadow = true;
  group.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.54, 0.2), shirtMat);
  rightArm.position.set(0.42, 0.86, 0);
  rightArm.castShadow = true;
  group.add(rightArm);

  // Voxel Head + Hair + Eyes
  const head = new THREE.Group();
  head.position.set(0, 1.44, 0);
  const skull = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.54, 0.54),
    new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.65 })
  );
  skull.castShadow = true;
  head.add(skull);

  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(0.64, 0.2, 0.6),
    new THREE.MeshStandardMaterial({ color: agent.hairColor, roughness: 0.85 })
  );
  hair.position.set(0, 0.25, -0.02);
  head.add(hair);

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), eyeMat);
  eyeL.position.set(-0.13, 0.02, 0.27);
  head.add(eyeL);

  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), eyeMat);
  eyeR.position.set(0.13, 0.02, 0.27);
  head.add(eyeR);
  group.add(head);

  // Selection ring under feet
  const selectRing = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.72, 24),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })
  );
  selectRing.rotation.x = -Math.PI / 2;
  selectRing.position.y = 0.16;
  selectRing.visible = false;
  group.add(selectRing);

  // Alert Beacon Ring under feet (debugging / error)
  const alertRing = new THREE.Mesh(
    new THREE.RingGeometry(0.75, 0.96, 24),
    new THREE.MeshBasicMaterial({ color: 0xf97316, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
  );
  alertRing.rotation.x = -Math.PI / 2;
  alertRing.position.y = 0.17;
  alertRing.visible = false;
  group.add(alertRing);

  return {
    group,
    body,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    selectRing,
    alertRing,
    zone: agent.zone,
    waypoints: []
  };
}
