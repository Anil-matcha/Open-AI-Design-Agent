"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import {
  FiSend,
  FiImage,
  FiTerminal,
  FiSearch,
  FiZap,
  FiLayout,
  FiChevronDown,
  FiUpload,
  FiPlus,
  FiSun,
  FiMoon,
  FiCheck,
  FiX,
  FiEdit2,
  FiArrowLeft,
  FiAlertCircle,
  FiGithub,
  FiVideo,
  FiMusic,
} from "react-icons/fi";
import { BiLoaderAlt } from "react-icons/bi";
import { RiRobot2Line, RiSparklingLine } from "react-icons/ri";
import { useApi } from "@/context/ApiContext";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import toast from "react-hot-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import PlanVisualizer from "@/components/PlanVisualizer";
import { FaTrash } from "react-icons/fa";

const CanvasArea = dynamic(() => import("@/components/CanvasArea"), {
  ssr: false,
});

const API_BASE = "/api/v1/creative-agent";

const TOOL_ICONS = {
  generate_image: "🎨", edit_image: "✏️", generate_video: "🎬",
  image_to_video: "🎥", edit_video: "🎞️", lipsync_video: "💋",
  concat_videos: "🔗", generate_audio: "🎵", enhance_image: "✨",
  upload_file: "📤", list_models: "📚", ask_user: "❓",
  propose_plan: "📋", list_assets: "📁", get_asset: "🔍", remaining_budget: "💰",
};

function EventPill({ event }) {
  if (event.type === "tool_call") return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-primary/10 border border-primary/20 text-primary text-[11px] mt-1 shadow-sm">
      <span>{TOOL_ICONS[event.name] || "🔧"}</span>
      <span className="font-semibold">{event.name}</span>
    </div>
  );

  if (event.type === "tool_result") {
    const ok = event.result?.ok !== false;
    const model = event.result?.model;
    if (event.name === "ask_user" && event.result?.ask_user) {
      const choices = event.result.choices || [];
      return (
        <div className="px-3 py-2 rounded bg-bg-page border border-primary/30 text-[12px] mt-1 shadow-sm">
          <div className="font-semibold text-primary mb-1">❓ {event.result.question}</div>
          {choices.length > 0 && (
            <div className="flex flex-col gap-1 mt-1">
              {choices.map((c, i) => (
                <div key={i} className="text-secondary-text">{i + 1}. {c}</div>
              ))}
            </div>
          )}
          <div className="text-[10px] text-secondary-text mt-1.5 italic">Reply to continue.</div>
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] border mt-1 shadow-sm ${
        ok
          ? "bg-green-500/10 text-green-600 border-green-500/20"
          : "bg-red-500/10 text-red-600 border-red-500/20"
      }`}>
        {ok ? <FiCheck size={11} /> : <FiX size={11} />}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-semibold">
            {ok
              ? (event.asset ? `Generated ${event.asset.kind}` : `Done`)
              : `Failed`}
          </span>
          {ok && model && (
            <span className="text-[9px] font-bold uppercase tracking-tight opacity-80">
              {model}
            </span>
          )}
          {!ok && event.result?.error && (
            <span className="text-[9px] opacity-70 truncate max-w-[160px]" title={event.result.error}>
              ↺ {String(event.result.error).replace(/^\w+Error:\s*/i, "").substring(0, 60)}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (event.type === "plan_propose") {
    if (event.handled) return null;
    return (
    <div className="flex flex-col gap-2">
      <PlanVisualizer plan={event} />
      <div className="flex items-center gap-2 px-2 pb-2">
        <button 
          onClick={() => event.onAction?.(event.job_id, "approve")}
          className="flex-1 py-2 rounded bg-primary text-white text-[12px] font-bold hover:brightness-110 transition-all flex items-center justify-center gap-2"
        >
          <FiCheck /> Approve & Execute
        </button>
        <button 
          onClick={() => event.onAction?.(event.job_id, "reject")}
          className="px-4 py-2 rounded bg-bg-card border border-divider text-secondary-text text-[12px] hover:bg-bg-page transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
    );
  }

  if (event.type === "info" && event.content?.includes("Waiting for approval")) {
    if (event.handled) return null;
    return (
       <div className="px-3 py-2 rounded bg-primary/5 border border-primary/20 text-[11px] mt-1 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary">
            <FiAlertCircle className="animate-pulse" />
            <span>{event.content}</span>
          </div>
          <div className="flex items-center gap-1">
             <button 
               onClick={() => event.onAction?.(event.job_id, "approve")}
               className="px-2 py-1 rounded bg-primary text-white text-[10px] font-bold"
             >
               Approve
             </button>
             <button 
               onClick={() => event.onAction?.(event.job_id, "reject")}
               className="px-2 py-1 rounded bg-bg-card border border-divider text-secondary-text text-[10px]"
             >
               Reject
             </button>
          </div>
       </div>
    );
  }

  if (event.type === "error") return (
    <div className="px-2.5 py-1.5 rounded bg-red-500/10 text-red-600 border border-red-500/20 text-[11px] mt-1 shadow-sm">
      ❌ {event.message}
    </div>
  );

  return null;
}

export default function CreativeAgentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdFromUrl = searchParams.get("session");
  const [sessionId, setSessionId] = useState(sessionIdFromUrl);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [assets, setAssets] = useState([]);
  const [activeTasks, setActiveTasks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const [sessions, setSessions] = useState([]);
  const [currentSessionName, setCurrentSessionName] =
    useState("Creative Canvas");
  const [showSessions, setShowSessions] = useState(false);

  const [sidebarWidth, setSidebarWidth] = useState(350);
  const isResizing = useRef(false);

  const { userData, loading: apiLoading } = useApi();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const canvasRef = useRef(null);
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const syncedUrlsRef = useRef(new Set());
  const justCreatedSessionRef = useRef(false);

  const fetchSessions = async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/sessions`);
      setSessions(data);
      if (sessionId) {
        const current = data.find((s) => s.id === sessionId);
        if (current) setCurrentSessionName(current.name);
      }
    } catch {}
  };

  const loadHistory = async () => {
    if (!sessionId) return;
    try {
      const { data } = await axios.get(`${API_BASE}/sessions/${sessionId}/messages`);
      if (data && data.length > 0) {
        // Cleanup: Hide approval cards that already have results
        const cleaned = data.map(m => ({
          ...m,
          events: (m.events || []).map((e, idx, arr) => {
            if ((e.type === "info" && e.content?.includes("Waiting for approval")) || e.type === "plan_propose") {
              const handled = arr.slice(idx + 1).some(next => 
                next.job_id === e.job_id && (next.type === "tool_result" || next.type === "error")
              );
              if (handled) return { ...e, handled: true };
            }
            return e;
          })
        }));
        setMessages(cleaned);
        checkActiveJobs(cleaned);
      } else {
        setMessages([{ role: "assistant", content: `Hello ${userData?.username || "User"} — what shall we create today?` }]);
      }
    } catch {
      setMessages([{ role: "assistant", content: `Hello ${userData?.username || "User"} — what shall we create today?` }]);
    }
  };

  const checkActiveJobs = async (currentMessages) => {
    if (!sessionId) return;
    try {
      const { data } = await axios.get(`${API_BASE}/sessions/${sessionId}/jobs`);
      const active = data.find(j => (j.status === "pending" || j.status === "processing") && j.id);
      if (active) {
        let aIdx = currentMessages.length - 1;
        if (aIdx < 0 || currentMessages[aIdx].role !== "assistant") {
          setMessages(prev => {
            const next = [...prev, { role: "assistant", content: "", events: [] }];
            resumePolling(active.id, next.length - 1);
            return next;
          });
        } else {
          resumePolling(active.id, aIdx);
        }
      }
    } catch {}
  };

  const loadAssets = async () => {
    if (!sessionId) return;
    try {
      const { data } = await axios.get(`${API_BASE}/sessions/${sessionId}/assets`);
      setAssets(data);
    } catch {}
  };

  useEffect(() => {
    setMounted(true);
    fetchSessions();
  }, []);

  useEffect(() => {
    if (justCreatedSessionRef.current) {
      justCreatedSessionRef.current = false;
      return;
    }
    syncedUrlsRef.current.clear();
    if (sessionId) {
      loadHistory();
      loadAssets();
      const current = sessions.find((s) => s.id === sessionId);
      if (current) setCurrentSessionName(current.name);
      else fetchSessions();
    } else {
      setMessages([
        {
          role: "assistant",
          content: `Hello ${userData?.username || "User"} — what shall we create today?`,
        },
      ]);
      setAssets([]);
      setCurrentSessionName("New Session");
    }
  }, [sessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!sessionId || assets.length === 0) return;
    const newAssets = assets.filter(
      (a) => !syncedUrlsRef.current.has(`${a.asset_label}-${a.url}`),
    );
    if (newAssets.length === 0) return;
    const sync = () => {
      if (canvasRef.current) {
        newAssets.forEach((a) => {
          const key = `${a.asset_label}-${a.url}`;
          if (syncedUrlsRef.current.has(key)) return;
          syncedUrlsRef.current.add(key);
          const kind =
            a.kind ||
            (a.url.match(/\.(mp4|webm|mov)$/i)
              ? "video"
              : a.url.match(/\.(mp3|wav|ogg|m4a)$/i)
                ? "audio"
                : "image");
          if (kind === "image") canvasRef.current.addImage(a.url);
          else if (kind === "video") canvasRef.current.addVideo(a.url);
          else if (kind === "audio") canvasRef.current.addAudio(a.url);
        });
        return true;
      }
      return false;
    };
    if (!sync()) {
      const t = setInterval(() => {
        if (sync()) clearInterval(t);
      }, 500);
      return () => clearInterval(t);
    }
  }, [assets, sessionId]);

  const processEvent = (ev, msgIdx) => {
    const p = ev.payload || {};
    const flat = (() => {
      switch (ev.type) {
        case "text":
          return { type: "text", content: p.content };
        case "info":
          return { type: "info", content: p.content };
        case "error":
          return { type: "error", message: p.message };
        case "tool_call":
          return { type: "tool_call", name: p.name, args: p.args };
        case "tool_result":
          return {
            type: "tool_result",
            name: p.name,
            result: p.result,
            asset: p.asset,
          };
        case "plan_propose":
          return {
            type: "plan_propose",
            title: p.title,
            nodes: p.nodes,
            total_credits: p.total_credits,
          };
        default:
          return { type: ev.type, ...p };
      }
    })();
    if (!flat) return;
    flat.job_id = ev.job_id || p.job_id;

    setMessages((prev) => {
      const arr = [...prev];
      if (msgIdx < 0 || msgIdx >= arr.length) return arr;
      const m = { ...arr[msgIdx], events: [...(arr[msgIdx].events || [])] };
      if (m.events.find((e) => e.id === ev.id)) return arr;
      m.events.push({ ...flat, id: ev.id });
      if (flat.type === "text")
        m.content = (m.content || "") + (flat.content || "");
      if (flat.type === "tool_result" || flat.type === "error") {
        m.events = m.events.map((e) =>
          e.job_id === flat.job_id &&
          (e.type === "info" || e.type === "plan_propose")
            ? { ...e, handled: true }
            : e,
        );
      }
      arr[msgIdx] = m;
      return arr;
    });

    if (
      flat.type === "tool_call" &&
      [
        "generate_image",
        "generate_video",
        "image_to_video",
        "edit_image",
        "edit_video",
        "enhance_image",
      ].includes(flat.name)
    ) {
      setActiveTasks((prev) => [
        ...prev,
        {
          taskId: `task-${Date.now()}`,
          modelName: flat.name,
          status: "processing",
        },
      ]);
    }
    if (flat.type === "tool_result" || flat.type === "error") {
      setActiveTasks((prev) => {
        const idx = prev.findIndex(t => t.modelName === flat.name);
        if (idx !== -1) {
          const next = [...prev];
          next.splice(idx, 1);
          return next;
        }
        return prev;
      });
      if (flat.asset)
        setAssets((pa) => {
          const idx = pa.findIndex(
            (a) =>
              (flat.asset.asset_label &&
                a.asset_label === flat.asset.asset_label) ||
              a.url === flat.asset.url,
          );
          if (idx !== -1) {
            const n = [...pa];
            n[idx] = { ...n[idx], ...flat.asset };
            return n;
          }
          return [...pa, flat.asset];
        });
    }
  };

  const resumePolling = async (jobId, assistantIdx) => {
    let cursor = 0;
    const POLL_INTERVAL = 1200;
    const MAX_DEAD_AIR = 6 * 60 * 1000;
    let lastProgress = Date.now();
    
    setBusy(true);
    while (true) {
      try {
        const { data } = await axios.get(`${API_BASE}/jobs/${jobId}/events`, {
          params: { since: cursor },
        });
        if (data.events?.length) {
          data.events.forEach(ev => processEvent(ev, assistantIdx));
          cursor = data.cursor || cursor;
          lastProgress = Date.now();
        }
        if (data.done) break;
        if (Date.now() - lastProgress > MAX_DEAD_AIR) throw new Error("Stalled");
      } catch (err) {
        if (Date.now() - lastProgress > MAX_DEAD_AIR) break;
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
    setBusy(false);
    loadAssets();
    // Persist final state
    setMessages(prev => {
      const next = [...prev];
      axios.patch(`${API_BASE}/sessions/${sessionId}/messages`, { messages: next }).catch(() => {});
      return next;
    });
  };

  const handleJobAction = async (jobId, action, reason = "") => {
    try {
      // The creative_agent_router uses specific endpoints for each action
      const endpoint = `${API_BASE}/jobs/${jobId}/${action}`;
      const { data } = await axios.post(
        endpoint,
        { reason },
      );

      // After approval, the job might resume processing.
      if (action === "approve") {
        const idx = messages.findIndex((m) =>
          m.events?.some((e) => e.job_id === jobId),
        );
        if (idx !== -1) resumePolling(jobId, idx);
      }
    } catch {
      toast.error("Action failed");
    }
  };

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const { data } = await axios.post(`${API_BASE}/sessions`, {});
    justCreatedSessionRef.current = true;
    setSessionId(data.id);
    router.replace(`?session=${data.id}`, { scroll: false });
    fetchSessions();
    return data.id;
  };

  const processFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const sid = await ensureSession();
      const { data: signData } = await axios.get(
        "/api/v1/get_upload_url",
        { params: { filename: file.name } },
      );
      const formData = new FormData();
      Object.entries(signData.fields).forEach(([k, v]) =>
        formData.append(k, v),
      );
      formData.append("file", file);
      // Inject proxy target for our local API route
      formData.append("x-proxy-target-url", signData.url);

      await axios.post("/api/v1/upload-binary", formData, {
        onUploadProgress: (pe) =>
          setUploadProgress(Math.round((pe.loaded * 100) / pe.total)),
      });
      const url = `https://cdn.muapi.ai/${signData.fields.key}`;
      const kind = file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : "image";
      const { data: reg } = await axios.post(
        `${API_BASE}/sessions/${sid}/assets`,
        { url, kind, source_tool: "upload" },
      );
      setAttachments((prev) => [
        ...prev,
        { asset_label: reg.asset_label, url, kind },
      ]);
      setAssets((prev) => [
        ...prev,
        { asset_label: reg.asset_label, url, kind, source_tool: "upload" },
      ]);
      toast.success(`Uploaded as ${reg.asset_label}`);
    } catch (err) {
      console.error("Upload error details:", err.response?.data || err.message);
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!busy) setIsDragging(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (!busy) processFile(e.dataTransfer.files?.[0]);
  };

  const sendMessage = async () => {
    if (!input.trim() || busy) return;
    let sid;
    try {
      sid = await ensureSession();
    } catch {
      return;
    }
    const typed = input.trim();
    const currentAttachments = [...attachments];
    const note = currentAttachments.length
      ? "\n\n[Attached " +
        currentAttachments.map((a) => `${a.asset_label} (${a.kind})`).join(", ") +
        "]"
      : "";

    const userMsg = {
      role: "user",
      content: typed + note,
      attachments: currentAttachments,
    };
    const newMessages = [...messages, userMsg];
    const assistantIdx = newMessages.length;

    setMessages([...newMessages, { role: "assistant", content: "", events: [] }]);
    setBusy(true);
    setInput("");
    setAttachments([]);

    try {
      const { data } = await axios.post(
        `${API_BASE}/sessions/${sid}/chat`,
        {
          message: typed,
          model: "gpt-5-mini",
          messages_snapshot: newMessages,
        },
      );
      await resumePolling(data.job_id, assistantIdx);
    } catch {
      toast.error("Send failed");
      setMessages(prev => {
        const arr = [...prev];
        if (assistantIdx >= 0) arr[assistantIdx] = { ...arr[assistantIdx], content: `❌ Send failed` };
        return arr;
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRenameSession = async (id, name) => {
    try {
      await axios.patch(`${API_BASE}/sessions/${id}`, { name });
      fetchSessions();
      toast.success("Renamed");
    } catch {
      toast.error("Rename failed");
    }
  };

  const handleDeleteSession = async (id) => {
    if (!window.confirm("Delete?")) return;
    try {
      await axios.delete(`${API_BASE}/sessions/${id}`);
      if (sessionId === id) {
        setSessionId(null);
        router.replace("/", { scroll: false });
      }
      fetchSessions();
    } catch {
      toast.error("Delete failed");
    }
  };

  const handleMouseMove = useCallback((e) => {
    if (isResizing.current) {
      const w = window.innerWidth - e.clientX;
      if (w > 300 && w < 800) setSidebarWidth(w);
    }
  }, []);
  const stopResizing = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", stopResizing);
    document.body.style.cursor = "default";
  }, [handleMouseMove]);

  const markdownComponents = React.useMemo(
    () => ({
      a: ({ node, ...props }) => {
        const isMedia = props.href?.match(/\.(jpeg|jpg|gif|png|webp|avif)$/i);
        const isVideo = props.href?.match(/\.(mp4|webm|mov)$/i);
        if (isMedia)
          return (
            <span className="block mt-2 mb-1">
              <a
                href={props.href}
                target="_blank"
                rel="noreferrer"
                className="block relative group overflow-hidden rounded border border-divider shadow-sm"
              >
                <img
                  src={props.href}
                  alt="Generated Asset"
                  className="w-full h-auto object-cover transition-transform group-hover:scale-105"
                />
                <span className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
              </a>
            </span>
          );
        if (isVideo)
          return (
            <span className="block mt-2 mb-1">
              <video
                src={props.href}
                controls
                className="w-full rounded border border-divider shadow-sm"
              />
            </span>
          );
        return (
          <a
            {...props}
            className="text-primary hover:underline underline-offset-4 font-bold"
            target="_blank"
            rel="noreferrer"
          />
        );
      },
      p: ({ node, ...props }) => <div className="mb-2 last:mb-0" {...props} />,
      code: ({ node, ...props }) => (
        <code className="bg-primary/10 text-primary px-1 rounded" {...props} />
      ),
    }),
    [],
  );

  if (!mounted || apiLoading) return null;

  return (
    <div
      className="h-dvh w-full text-sm flex flex-col bg-bg-page text-primary-text overflow-hidden"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      <main className="flex h-full w-full overflow-hidden">
        <div className="flex flex-col relative bg-bg-page flex-1 overflow-hidden">
          <div className="flex justify-between items-center z-10 p-2 border-b border-divider/50 bg-bg-page">
            <div className="relative flex items-center gap-1">
              <button
                onClick={() => setShowSessions(!showSessions)}
                className="p-1.5 rounded hover:bg-bg-card transition-colors text-secondary-text flex items-center gap-2"
              >
                <FiLayout size={18} />{" "}
                <span className="font-semibold text-primary-text text-[13px]">
                  {currentSessionName}
                </span>{" "}
                <FiChevronDown
                  size={14}
                  className={showSessions ? "rotate-180" : ""}
                />
              </button>
              {showSessions && (
                <div className="absolute top-full left-0 mt-2 w-72 bg-bg-card border border-divider shadow-2xl rounded z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100">
                  <div className="p-3 border-b border-divider flex items-center justify-between bg-bg-page/50">
                    <span className="text-[10px] font-bold text-secondary-text uppercase tracking-widest">
                      Sessions
                    </span>
                    <button
                      onClick={() => {
                        setSessionId(null);
                        router.replace("/", { scroll: false });
                        setShowSessions(false);
                      }}
                      className="text-[10px] font-bold text-primary hover:underline"
                    >
                      New Session
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto scrollbar-subtle">
                    {sessions.map((s) => (
                      <div
                        key={s.id}
                        className={`group flex items-center justify-between px-4 py-2.5 cursor-pointer border-l-2 ${sessionId === s.id ? "bg-primary/5 border-primary" : "hover:bg-bg-page border-transparent"}`}
                        onClick={() => {
                          setSessionId(s.id);
                          router.replace(`?session=${s.id}`, { scroll: false });
                          setShowSessions(false);
                        }}
                      >
                        <div className="flex-1 min-w-0 pr-2">
                          <p
                            className={`text-[13px] truncate ${sessionId === s.id ? "font-bold text-primary" : "text-primary-text"}`}
                          >
                            {s.name}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const n = window.prompt("New name:", s.name);
                              if (n) handleRenameSession(s.id, n);
                            }}
                            className="p-1 rounded hover:bg-bg-card text-secondary-text"
                          >
                            <FiEdit2 size={12} />
                          </button>
                          {/* <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSession(s.id);
                            }}
                            className="p-1 rounded hover:bg-red-500/10 text-secondary-text"
                          >
                            <FiX size={12} />
                          </button> */}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 h-8 border border-divider rounded bg-bg-page/30 px-2 ml-1">
                <span className="font-bold text-xs">
                  $ {userData?.balance || "0.00"}
                </span>
                <a
                  href="https://muapi.ai/topup"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 rounded hover:bg-bg-card"
                >
                  <FiPlus size={14} />
                </a>
              </div>
              <button
                onClick={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
                className="p-2 rounded hover:bg-bg-card text-secondary-text"
              >
                <FiSun size={18} />
              </button>
              <a
                href="https://github.com/Anil-matcha/Open-Lovart"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded hover:bg-bg-card text-secondary-text"
              >
                <FiGithub size={18} />
              </a>
            </div>
          </div>

          <div
            className="flex-1 relative bg-bg-page/50"
            style={{
              backgroundSize: "32px 32px",
              backgroundImage: `radial-gradient(circle, ${resolvedTheme === "dark" ? "#1e293b" : "#cbd5e1"} 1px, transparent 1px)`,
            }}
          >
            <CanvasArea
              ref={canvasRef}
              theme={resolvedTheme}
              activeTasks={activeTasks}
              setActiveTasks={setActiveTasks}
              onZoomChange={setZoomLevel}
            />
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-bg-card border border-divider shadow-2xl px-2 py-1.5 rounded">
              <div className="flex items-center gap-3 px-3 border-r border-divider">
                <span className="text-[10px] font-bold text-secondary-text uppercase tracking-widest">
                  {zoomLevel}%
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() =>
                      canvasRef.current?.updateZoom(
                        Math.max(0.1, (zoomLevel - 10) / 100),
                      )
                    }
                    className="w-5 h-5 rounded border border-divider flex items-center justify-center text-secondary-text hover:text-primary-text hover:border-primary transition-all"
                  >
                    -
                  </button>
                  <button
                    onClick={() =>
                      canvasRef.current?.updateZoom(
                        Math.min(5, (zoomLevel + 10) / 100),
                      )
                    }
                    className="w-5 h-5 rounded border border-divider flex items-center justify-center text-secondary-text hover:text-primary-text hover:border-primary transition-all"
                  >
                    +
                  </button>
                </div>
              </div>
              <button
                onClick={() => canvasRef.current?.handleZoomToFit?.()}
                className="p-1.5 rounded hover:bg-bg-page text-secondary-text"
                title="Zoom to Fit"
              >
                <FiLayout size={14} />
              </button>
              <button
                onClick={() => canvasRef.current?.handleExportCanvas?.()}
                className="p-1.5 rounded hover:bg-bg-page text-secondary-text"
                title="Export PNG"
              >
                <FiImage size={14} />
              </button>
              <button
                onClick={() => canvasRef.current?.handleClearCanvas?.()}
                className="p-1.5 rounded hover:bg-bg-page hover:text-red-500 text-secondary-text"
                title="Clear Canvas"
              >
                <FaTrash size={12} />
              </button>
            </div>
          </div>
        </div>

        <div
          className="w-[1px] h-full bg-divider/50 hover:bg-primary cursor-col-resize active:bg-primary z-30"
          onMouseDown={(e) => {
            isResizing.current = true;
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", stopResizing);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        />

        <div
          className="flex flex-col bg-bg-card border-l border-divider/50 h-full relative z-20 shadow-[-10px_0_20px_rgba(0,0,0,0.02)]"
          style={{ width: sidebarWidth }}
        >
          <div className="p-4 flex items-center justify-between border-b border-divider bg-bg-card">
            <div className="flex flex-col">
              <h2 className="font-bold text-[13px] text-primary-text uppercase tracking-widest leading-none flex items-center gap-2">
                <RiSparklingLine className="text-primary" /> CREATIVE AGENT
              </h2>
              <span className="text-[10px] text-secondary-text mt-1.5">
                Auto Model • Multi-tool Access
              </span>
            </div>
            {sessionId && (
              <button
                onClick={() => {
                  setSessionId(null);
                  router.push("/");
                }}
                className="p-1.5 hover:bg-bg-page hover:text-primary transition-colors rounded"
                title="New Session"
              >
                <FiPlus size={16} />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-subtle space-y-6">
            {messages.map((msg, idx) => {
              if (!msg) return null;
              return (
                <div key={idx} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} animate-fade-in-up`}>
                  {msg.role === "assistant" && idx > 0 && (
                    <div className="flex items-center gap-1.5 text-[10px] font-medium text-secondary-text mb-1 ml-1">
                      <RiRobot2Line /> Agent
                    </div>
                  )}
                  <div className={`max-w-[90%] space-y-3 ${msg.role === "user" ? "text-right" : "text-left"}`}>
                    <div className={`px-3 py-2 text-[13px] leading-relaxed break-words
                      ${msg.role === "user" ? "bg-blue-500 text-white rounded-md rounded-br shadow-sm border border-divider/50" : "text-primary-text bg-bg-page rounded-md rounded-bl shadow-sm border border-divider"}`}>
                      {msg.content ? (
                        msg.role === "assistant" ? (
                          <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-black/30">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={markdownComponents}
                            >
                              {msg.content} 
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <div className="prose prose-invert max-w-none text-white prose-p:leading-relaxed">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={markdownComponents}
                              >
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="flex flex-col gap-2 mt-2 w-full">
                                {msg.attachments.map(att => (
                                  <div key={att.asset_label} className="relative w-full rounded border border-white/20 overflow-hidden shadow-sm bg-black/10">
                                    {att.kind === "image" && (
                                      <img src={att.url} alt={att.asset_label} className="w-full max-h-64 object-contain" />
                                    )}
                                    {att.kind === "video" && (
                                      <video src={att.url} controls className="w-full max-h-64 object-contain" />
                                    )}
                                    {att.kind === "audio" && (
                                      <div className="p-2">
                                        <audio src={att.url} controls className="w-full" />
                                      </div>
                                    )}
                                    {!["image", "video", "audio"].includes(att.kind) && (
                                      <div className="w-full p-4 flex items-center justify-center text-[10px] text-white/70">
                                        {att.kind}: {att.asset_label}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      ) : (msg.role === "assistant" && busy) && (
                        <BiLoaderAlt size={14} className="animate-spin inline" />
                      )}
                    </div>

                    {(msg.events || [])
                      .filter(
                        (e) =>
                          e &&
                          [
                            "tool_call",
                            "tool_result",
                            "plan_propose",
                            "error",
                            "info",
                          ].includes(e.type),
                      )
                      .map((ev, i) => (
                        <EventPill
                          key={i}
                          event={{ ...ev, onAction: handleJobAction }}
                        />
                      ))}
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>
          <div className="p-2 border-t border-divider/30 bg-bg-card">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`rounded border bg-bg-page shadow-sm flex flex-col transition-all relative overflow-hidden ${isDragging ? "border-dashed border-primary bg-primary/5 ring-4 ring-primary/10" : "border-divider"} ${busy ? "opacity-60 pointer-events-none" : "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10"}`}
            >
              {isDragging && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/5 backdrop-blur-[1px] rounded">
                  <div className="bg-primary/10 p-4 rounded-full border-2 border-primary/20 animate-pulse text-primary">
                    <FiUpload size={32} />
                  </div>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                onInput={(e) => {
                  e.target.style.height = "auto";
                  e.target.style.height =
                    Math.min(e.target.scrollHeight, 120) + "px";
                }}
                placeholder="Start with an idea..."
                className="w-full bg-transparent px-3 py-3 text-[13px] resize-none focus:outline-none min-h-[50px] max-h-[120px] scrollbar-subtle"
                rows={1}
                disabled={busy}
              />
              {(uploading || attachments.length > 0) && (
                <div className="flex flex-wrap gap-2 px-3 pb-3 border-b border-divider/10">
                  {attachments.map((att) => (
                    <div
                      key={att.asset_label}
                      className="relative group w-12 h-12 rounded border border-divider overflow-hidden bg-bg-page"
                    >
                      {att.kind === "image" ? (
                        <img
                          src={att.url}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[8px] font-bold text-secondary-text">
                          {att.kind}
                        </div>
                      )}
                      <button
                        onClick={() =>
                          setAttachments((prev) =>
                            prev.filter(
                              (a) => a.asset_label !== att.asset_label,
                            ),
                          )
                        }
                        className="absolute top-0 right-0 p-0.5 bg-black/60 text-white rounded-bl opacity-0 group-hover:opacity-100 hover:bg-red-500"
                      >
                        <FiX size={10} />
                      </button>
                    </div>
                  ))}
                  {uploading && (
                    <div className="w-12 h-12 rounded border border-primary/30 border-dashed flex items-center justify-center bg-primary/5">
                      <BiLoaderAlt
                        className="animate-spin text-primary"
                        size={14}
                      />
                    </div>
                  )}
                </div>
              )}
              <div className="px-3 py-2 flex items-center justify-between">
                <input
                  type="file"
                  className="hidden"
                  ref={fileInputRef}
                  accept="image/*,video/*,audio/*"
                  onChange={(e) => processFile(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy || uploading}
                  className="p-1.5 rounded hover:bg-bg-page text-secondary-text hover:text-primary transition-colors"
                >
                  <FiUpload size={18} />
                </button>
                <button
                  type="button"
                  onClick={sendMessage}
                  disabled={busy || !input.trim()}
                  className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-all disabled:opacity-30 disabled:scale-100"
                >
                  {busy ? (
                    <BiLoaderAlt className="animate-spin" />
                  ) : (
                    <FiSend size={14} />
                  )}
                </button>
              </div>
            </div>
            <p className="mt-1 text-[10px] text-center text-secondary-text/40 font-medium">
              Powered by Muapi AI & Open Source
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
