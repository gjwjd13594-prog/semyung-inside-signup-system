import { useEffect, useState, useCallback } from "react";
import { getSocket } from "../lib/socket";
import { api } from "../api/client";

export interface ChatMessage {
  id: string;
  roomId: string;
  content: string;
  createdAt: string;
  sender: { id: number | null; nickname: string } | null;
  isSystem: boolean;
}

export function useChat(roomId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const socket = getSocket();
    api.get(`/api/chats/${roomId}/messages`).then((r) => setMessages(r.data.messages));
    socket.emit("room:join", roomId, (ack: { ok: boolean; message?: string }) => {
      if (!ack?.ok) console.warn(ack?.message);
    });

    const onNew = (msg: ChatMessage) => {
      if (msg.roomId !== roomId) return;
      setMessages((prev) => [...prev, msg]);
      socket.emit("room:read", roomId);
    };
    socket.on("message:new", onNew);
    return () => { socket.off("message:new", onNew); };
  }, [roomId]);

  const send = useCallback((content: string) => {
    getSocket().emit("message:send", { roomId, content }, (ack: { ok: boolean; filtered?: boolean }) => {
      if (ack?.filtered) console.info("금지어가 가려졌어요");
    });
  }, [roomId]);

  return { messages, send };
}
