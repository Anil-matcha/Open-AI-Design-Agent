"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import {
  FiPlus, FiUpload, FiSend, FiSearch, FiZap,
  FiImage, FiLayout, FiTerminal, FiChevronDown,
  FiSun, FiMoon, FiMoreHorizontal, FiArrowRight, FiTrash2,
  FiCode, FiCopy
} from "react-icons/fi";
import { CgTerminal } from "react-icons/cg";
import { RiSparklingLine, RiRobot2Line } from "react-icons/ri";
import { GoBook, GoLightBulb } from "react-icons/go";
import { HiOutlineCube } from "react-icons/hi";
import { useApi } from "@/context/ApiContext";
import { useTheme } from "next-themes";
import Link from "next/link";
import toast from "react-hot-toast";
import Navbar from "@/components/Navbar";

const API = "/api/v1/creative-agent";

export default function AssistantDashboard() {
  const router = useRouter();
  const { userData } = useApi();
  const [mounted, setMounted] = useState(false);
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState([]);
  const [showSkillsMenu, setShowSkillsMenu] = useState(false);
  const [activeSkill, setActiveSkill] = useState(null);
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const [hoveredAsset, setHoveredAsset] = useState(null);
  const textareaRef = React.useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [attachments, setAttachments] = useState([]);
  const fileInputRef = React.useRef(null);
  const [placeholderText, setPlaceholderText] = useState("");

  const placeholders = React.useMemo(() => [
    "Ask the agent to generate an image...",
    "Ask the agent to create a video...",
    "Ask the agent to edit an image...",
    "Ask the agent to plan a social campaign..."
  ], []);

  useEffect(() => {
    let currentPlaceholderIdx = 0;
    let currentCharIdx = 0;
    let isDeleting = false;
    let typingTimer;

    const type = () => {
      const currentString = placeholders[currentPlaceholderIdx];
      
      if (isDeleting) {
        setPlaceholderText(currentString.substring(0, currentCharIdx - 1));
        currentCharIdx--;
      } else {
        setPlaceholderText(currentString.substring(0, currentCharIdx + 1));
        currentCharIdx++;
      }

      let typeSpeed = isDeleting ? 20 : 50;

      if (!isDeleting && currentCharIdx === currentString.length) {
        typeSpeed = 2000;
        isDeleting = true;
      } else if (isDeleting && currentCharIdx === 0) {
        isDeleting = false;
        currentPlaceholderIdx = (currentPlaceholderIdx + 1) % placeholders.length;
        typeSpeed = 500;
      }

      typingTimer = setTimeout(type, typeSpeed);
    };

    typingTimer = setTimeout(type, 1000);

    return () => clearTimeout(typingTimer);
  }, [placeholders]);

  useEffect(() => {
    setMounted(true);
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      const { data } = await axios.get(`${API}/sessions`);
      // Fetch assets for each session to show thumbnails
      const sessionsWithAssets = await Promise.all(data.map(async (s) => {
        try {
          const { data: assets } = await axios.get(`${API}/sessions/${s.id}/assets`);
          return { ...s, assets: assets.slice(0, 4) }; // Keep first 4 for thumbnail grid
        } catch {
          return { ...s, assets: [] };
        }
      }));
      setSessions(sessionsWithAssets);
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    } finally {
      setLoading(false);
    }
  };


  const deleteSession = async (sessionId, sessionName) => {
    if (!window.confirm(`Delete chat "${sessionName || "Untitled"}"? This cannot be undone.`)) return;
    try {
      await axios.delete(`${API}/sessions/${sessionId}`);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      toast.success("Chat deleted");
    } catch (err) {
      toast.error("Failed to delete chat");
    }
  };

  const processFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      // In a real local app, you'd upload this to a local server or cloud.
      // We'll mimic the standard flow here.
      toast.error("File upload is not fully implemented in this local version yet.");
    } catch (err) {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFileUpload = (e) => processFile(e.target.files?.[0]);

  const startNewSession = async (initialMsg = "", skill = null, initialAttachments = []) => {
    try {
      const { data } = await axios.post(`${API}/sessions`, {});
      const sessionId = data.id;
      let url = `/canvas?session=${sessionId}`;
      let registeredAssets = [];

      if (initialAttachments.length > 0) {
        const results = await Promise.all(initialAttachments.map(a => 
          axios.post(`${API}/sessions/${sessionId}/assets`, { 
            url: a.url, 
            kind: a.kind, 
            source_tool: "upload" 
          })
        ));
        registeredAssets = results.map(r => r.data);
        const labels = registeredAssets.map(a => a.asset_label).join(",");
        url += `&a=${encodeURIComponent(labels)}`;
      }
      
      if (initialMsg) {
        const attachmentNote = registeredAssets.length
          ? "\n\n[Attached " + registeredAssets.map(a => `${a.asset_label} (${a.kind})`).join(", ") + "]"
          : "";
        
        const userMsg = {
          role: "user",
          content: initialMsg + attachmentNote,
          attachments: registeredAssets,
          timestamp: new Date().toISOString(),
          skill_name: skill?.name
        };

        if (skill) {
          const primaryInputKey = skill.inputs?.[0] || "premise";
          await axios.post(`${API}/sessions/${sessionId}/run-skill`, {
            skill_name: skill.name,
            inputs: { [primaryInputKey]: initialMsg },
            messages_snapshot: [userMsg],
            model: "gpt-4o"
          });
        } else {
          await axios.post(`${API}/sessions/${sessionId}/chat`, {
            message: initialMsg,
            messages_snapshot: [userMsg],
            model: "gpt-4o"
          });
        }
      }
      
      router.push(`/canvas?session=${sessionId}`);
    } catch (err) {
      toast.error("Failed to start session");
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() || attachments.length > 0) {
        startNewSession(input.trim(), activeSkill, attachments);
      }
    }
  };


  if (!mounted) return null;

  return (
    <div className="h-dvh w-full text-sm flex flex-col items-center bg-bg-page animate-fade-in text-primary-text">
      <Navbar />
      <main className="flex flex-col gap-6 items-center w-full h-full overflow-y-auto">
        <div className="flex-1 flex flex-col gap-6 sm:gap-8 items-center w-full max-w-7xl pt-6 sm:pt-8 pb-12 px-4 sm:px-8 lg:px-0">
          <h1 className="text-5xl font-bold tracking-tight text-center flex items-center gap-3">
            Design is easier with <span className="text-primary">Agents</span>
          </h1>
          <p className="text-secondary-text text-lg text-center">
            The open-source design agent that gets you and gets the job done
          </p>
          <div className="flex items-center gap-6 text-[10px] font-bold uppercase tracking-widest">
            <a href="https://github.com/Anil-matcha/Open-Lovart" target="_blank" className="flex items-center gap-2 px-4 py-2 bg-bg-card border border-divider rounded-full shadow-sm hover:shadow-md hover:border-primary/30 transition-all text-secondary-text hover:text-primary">
              <CgTerminal size={12} className="text-primary" />
              View Source
            </a>
          </div>
          <div className="w-full max-w-3xl relative">
            <div className="bg-bg-card border border-divider rounded-md shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-1 focus-within:shadow-[0_8px_40px_rgb(0,0,0,0.08)] transition-all">
              <textarea
                ref={textareaRef}
                value={input}
                autoFocus
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={placeholderText}
                className="w-full bg-transparent border-none focus:ring-0 text-lg p-4 h-24 resize-none placeholder:text-secondary-text/50 outline-none scrollbar-subtle"
              />
              <div className="flex items-center justify-between px-2 pb-2">
                <div className="flex items-center gap-1">
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    onChange={handleFileUpload}
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 hover:bg-bg-page rounded-full text-secondary-text transition-colors relative"
                    title="Upload File"
                  >
                    {uploading ? (
                      <div className="w-12 h-12 rounded border border-divider border-dashed flex flex-col items-center justify-center bg-bg-page/50">
                        <span className="border-2 border-t-transparent border-primary rounded-full w-7 h-7 animate-spin absolute"></span>
                        <span className="text-[10px] font-bold text-secondary-text z-10">{uploadProgress}%</span>
                      </div>
                    ) : (
                      <FiPlus size={20} />
                    )}
                  </button>
                  
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => (input.trim() || attachments.length > 0) && startNewSession(input.trim(), activeSkill, attachments)}
                    disabled={!input.trim() && attachments.length === 0}
                    className={`p-2 rounded-full transition-all ${input.trim() || attachments.length > 0 ? "bg-primary text-white shadow-lg shadow-primary/20 hover:scale-105" : "bg-bg-page text-secondary-text/30"}`}
                  >
                    <FiSend size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="w-full">
            <h2 className="text-xl font-bold mb-6">Recent Projects</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {/* New Project Card */}
              <button 
                onClick={() => router.push("/canvas")}
                className="group aspect-[16/10] bg-bg-card border-2 border-dashed border-divider rounded-md flex flex-col items-center justify-center gap-3 hover:border-primary hover:bg-primary/5 transition-all"
              >
                <div className="w-10 h-10 rounded-full bg-bg-page border border-divider flex items-center justify-center text-secondary-text group-hover:text-primary group-hover:border-primary group-hover:scale-110 transition-all">
                  <FiPlus size={24} />
                </div>
                <span className="text-xs font-bold text-secondary-text group-hover:text-primary">New Project</span>
              </button>

              {/* Session Cards */}
              {sessions.map((session) => (
                <div 
                  key={session.id}
                  onClick={() => router.push(`/canvas?session=${session.id}`)}
                  className="group relative aspect-[16/10] bg-bg-card border border-divider rounded overflow-hidden cursor-pointer hover:shadow-xl hover:border-primary/50 transition-all"
                >
                  <div className="h-full w-full grid grid-cols-2 grid-rows-2 gap-0.5 bg-divider/20">
                    {session.assets && session.assets.length > 0 ? (
                      session.assets.map((asset, i) => (
                        <div key={i} className={`relative overflow-hidden ${session.assets.length === 1 ? 'col-span-2 row-span-2' : session.assets.length === 2 ? 'row-span-2' : ''}`}>
                          {asset.kind === "image" ? (
                            <img src={asset.url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-black/5 flex items-center justify-center"><FiImage className="text-secondary-text/20" size={32} /></div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="col-span-2 row-span-2 flex items-center justify-center bg-bg-page">
                        <RiRobot2Line size={48} className="text-secondary-text/10" />
                      </div>
                    )}
                    {session.assets && session.assets.length > 0 && session.assets.length < 4 && Array.from({ length: 4 - session.assets.length }).map((_, i) => (
                      <div key={`empty-${i}`} className="bg-bg-page/50" />
                    ))}
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSession(session.id, session.name); }}
                    className="absolute top-2 right-2 z-10 p-1.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all"
                    title="Delete chat"
                  >
                    <FiTrash2 size={14} />
                  </button>

                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                    <div className="text-white font-bold text-sm truncate">{session.name || "Untitled"}</div>
                    <div className="text-white/60 text-[10px] mt-1">{session.assets?.length || 0} assets</div>
                  </div>
                  
                  <div className="absolute bottom-0 left-0 right-0 p-3 bg-bg-card/90 backdrop-blur-sm border-t border-divider opacity-100 group-hover:opacity-0 transition-opacity">
                    <div className="text-primary-text font-bold text-xs truncate">{session.name || "Untitled Session"}</div>
                  </div>
                </div>
              ))}

              {loading && Array.from({ length: 3 }).map((_, i) => (
                <div key={`skeleton-${i}`} className="aspect-[16/10] bg-bg-card border border-divider rounded-md animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
