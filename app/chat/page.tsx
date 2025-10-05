"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ArrowLeft, Send, Search } from "lucide-react"
import { apiEndpoints, apiCall } from "@/lib/api-config"

interface ChatUser {
  id: number
  username: string
  avatar: string
  last_message?: string
  last_message_time?: string
  unread_count?: number
  is_online?: boolean
  last_seen?: string
}

interface Message {
  id: number
  sender_id: number
  receiver_id: number
  message: string
  created_at: string
  sender_username: string
  sender_avatar: string
}

interface BlogUser {
  id: number
  username: string
  email: string
  avatar: string
}

export default function ChatPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<BlogUser | null>(null)
  const [users, setUsers] = useState<ChatUser[]>([])
  const [userOffset, setUserOffset] = useState(0)
  const USER_LIMIT = 30
  const [selectedUser, setSelectedUser] = useState<ChatUser | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [msgOffset, setMsgOffset] = useState(0)
  const MSG_LIMIT = 30
  const [searchQuery, setSearchQuery] = useState("")
  const [isConnected, setIsConnected] = useState(true)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [lastMessageCheck, setLastMessageCheck] = useState(Date.now())
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    checkUserSession()
  }, [])

  useEffect(() => {
    if (currentUser) {
      loadUsers()
      setupRealtimeConnection()
    }

    // Cleanup on unmount or currentUser change
    return () => {
      cleanupRealtimeConnection()
    }
  }, [currentUser])

  useEffect(() => {
    if (selectedUser && currentUser) {
      loadMessages()
    }
  }, [selectedUser, currentUser])

  useEffect(() => {
    if (messages.length > 0) {
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [messages])

  // Cleanup polling when component unmounts
  useEffect(() => {
    return () => {
      cleanupRealtimeConnection()
    }
  }, [])

  const checkUserSession = async () => {
    const token = localStorage.getItem("blog_token")
    const user = localStorage.getItem("blog_user")

    console.log("🔍 Checking user session:", {
      hasToken: !!token,
      hasUser: !!user,
      token: token ? `${token.substring(0, 20)}...` : 'none'
    })

    if (token && user) {
      try {
        // Validate token before setting user
        const response = await apiCall(apiEndpoints.heartbeat, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include'
        })

        if (response.success) {
          console.log("✅ Token verified successfully")
          // Token is valid, set user
          setCurrentUser(JSON.parse(user))
          localStorage.setItem("blog_login_time", Date.now().toString())
        } else {
          // Token expired or invalid, clear storage
          console.log("❌ Token verification failed")
          localStorage.removeItem("blog_token")
          localStorage.removeItem("blog_user")
          localStorage.removeItem("blog_login_time")
          alert("Sessiya muddati tugagan. Qaytadan login qiling!")
          router.push("/")
        }
      } catch (error) {
        console.log("⚠️ Token verification error:", error instanceof Error ? error.message : 'Unknown error')
        // On network error, still set user for offline experience
        try {
          setCurrentUser(JSON.parse(user))
        } catch (parseError) {
          console.error("❌ Error parsing cached user data:", parseError)
          localStorage.removeItem("blog_token")
          localStorage.removeItem("blog_user")
          localStorage.removeItem("blog_login_time")
          alert("Login ma'lumotlari noto'g'ri. Qaytadan login qiling!")
          router.push("/")
        }
      }
    } else {
      console.log("❌ No token or user found")
      alert("Avval login qiling!")
      router.push("/")
    }
  }

  const setupRealtimeConnection = () => {
    // Clear any existing polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }

    // Start polling for new messages every 3 seconds
    pollIntervalRef.current = setInterval(async () => {
      try {
        const token = localStorage.getItem('blog_token')
        if (!token || !selectedUser || !currentUser) return

        // Check for new messages
        await checkNewMessages(token)

        // Update online status for all users (less frequently)
        if (Math.floor(Date.now() / 1000) % 10 === 0) { // Every 10 polls (30 seconds)
          await updateOnlineStatus(token)
        }

      } catch (error) {
        // Silent error handling - don't show to user
        console.error('Polling error:', error)
      }
    }, 3000) // Poll every 3 seconds
  }

  const checkNewMessages = async (token: string) => {
    try {
      const response = await apiCall(
        `${apiEndpoints.chatMessages}&user_id=${selectedUser!.id}&token=${token}&limit=20&offset=0`
      )

      if (response.success && response.messages && response.messages.length > 0) {
        // Filter out messages that are already in our state
        const existingMessageIds = new Set(messages.map((m: Message) => m.id))
        const uniqueNewMessages = response.messages.filter((msg: Message) => !existingMessageIds.has(msg.id))

        if (uniqueNewMessages.length > 0) {
          setMessages(prev => {
            // Merge new messages and sort by creation time
            const allMessages = [...prev, ...uniqueNewMessages]
            return allMessages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          })
          console.log('New messages received via polling:', uniqueNewMessages.length)
        }
      }
    } catch (error) {
      console.error('Error checking new messages:', error)
    }
  }

  const updateOnlineStatus = async (token: string) => {
    try {
      const usersResponse = await apiCall(
        `${apiEndpoints.chatUsers}&token=${token}&limit=30&offset=0`
      )

      if (usersResponse.success && usersResponse.users) {
        setUsers(usersResponse.users)
      }
    } catch (error) {
      console.error('Error updating online status:', error)
    }
  }

  const cleanupRealtimeConnection = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const loadUsers = async (append = false) => {
    try {
      const token = localStorage.getItem("blog_token")
      console.log("Loading chat users with token:", token ? "present" : "missing")
      const usedOffset = append ? userOffset : 0
      const data = await apiCall(`${apiEndpoints.chatUsers}&search=${searchQuery}&token=${token}&limit=${USER_LIMIT}&offset=${usedOffset}`)
      if (data.success) {
        if (append) {
          setUsers((prev) => [...prev, ...data.users])
          setUserOffset(usedOffset + USER_LIMIT)
        } else {
          setUsers(data.users)
          setUserOffset(USER_LIMIT)
        }
        console.log("Chat users loaded:", data.users.length)
      } else {
        console.error("Failed to load chat users:", data)
      }
    } catch (error) {
      console.error("Error loading users:", error)
    }
  }

  const loadMessages = async (append = false) => {
    if (!selectedUser) return

    try {
      const token = localStorage.getItem("blog_token")
      console.log("Loading messages between users:", { currentUser: currentUser?.id, selectedUser: selectedUser.id })
      const usedOffset = append ? msgOffset : 0
      const data = await apiCall(`${apiEndpoints.chatMessages}&user_id=${selectedUser.id}&token=${token}&limit=${MSG_LIMIT}&offset=${usedOffset}`)
      if (data.success) {
        if (append) {
          setMessages((prev) => [...prev, ...data.messages])
          setMsgOffset(usedOffset + MSG_LIMIT)
        } else {
          setMessages(data.messages)
          setMsgOffset(MSG_LIMIT)
        }
        console.log("Messages loaded:", data.messages.length)
      } else {
        console.error("Failed to load messages:", data)
      }
    } catch (error) {
      console.error("Error loading messages:", error)
    }
  }

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !selectedUser || !currentUser) {
      console.warn("Cannot send message: missing data")
      return
    }

    const messageText = newMessage.trim()
    setNewMessage("") // Clear input immediately

    // Create optimistic message for immediate UI update
    const optimisticMessage: Message = {
      id: -Date.now(), // Negative temporary ID
      sender_id: currentUser.id,
      receiver_id: selectedUser.id,
      message: messageText,
      created_at: new Date().toISOString(),
      sender_username: currentUser.username,
      sender_avatar: currentUser.avatar,
    }

    // Add optimistic message to UI immediately
    setMessages(prev => [...prev, optimisticMessage])

    try {
      console.log("Sending message:", { to: selectedUser.id, message: messageText })
      const token = localStorage.getItem("blog_token")

      const data = await apiCall(`${apiEndpoints.sendMessage}&token=${token}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        credentials: 'include',
        body: JSON.stringify({
          receiver_id: selectedUser.id,
          message: messageText,
        }),
      })

      if (data.success && data.message_id) {
        // Replace optimistic message with real message from server
        const realMessage: Message = {
          id: data.message_id,
          sender_id: currentUser.id,
          receiver_id: selectedUser.id,
          message: messageText,
          created_at: new Date().toISOString(),
          sender_username: currentUser.username,
          sender_avatar: currentUser.avatar,
        }

        setMessages(prev => prev.map(msg =>
          msg.id === optimisticMessage.id ? realMessage : msg
        ))
        console.log("Message sent successfully with ID:", data.message_id)
      } else {
        console.error("Failed to send message:", data)
        // Remove failed optimistic message
        setMessages(prev => prev.filter(msg => msg.id !== optimisticMessage.id))
        // Restore message text for retry
        setNewMessage(messageText)
        // Show subtle error without alert
        console.warn("Message failed to send - please try again")
      }
    } catch (error) {
      console.error("Send message error:", error)
      // Remove failed optimistic message
      setMessages(prev => prev.filter(msg => msg.id !== optimisticMessage.id))
      // Restore message text for retry
      setNewMessage(messageText)
      console.warn("Network error - message not sent")
    }
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Login sahifasiga yo'naltirilmoqda...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => router.push("/")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Orqaga
            </Button>
            <h1 className="text-xl font-bold text-primary">Chat</h1>
            <div className="w-20"></div> {/* Spacer for centering */}
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-200px)]">
          {/* Users List - Mobile Responsive */}
          <Card className={`lg:col-span-1 ${selectedUser ? 'hidden lg:block' : 'block'}`}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                Foydalanuvchilar
                {selectedUser && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="lg:hidden"
                    onClick={() => setSelectedUser(null)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                )}
              </CardTitle>
              <div className="flex space-x-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    placeholder="Qidirish..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && loadUsers()}
                    className="pl-10"
                  />
                </div>
                <Button onClick={() => loadUsers()} size="sm">
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                <div className="space-y-1 p-4">
                  {users.map((user) => (
                    <div
                      key={user.id}
                      onClick={() => setSelectedUser(user)}
                      className={`flex items-center space-x-3 p-3 rounded-lg cursor-pointer transition-colors ${
                        selectedUser?.id === user.id ? "bg-primary/10 border border-primary/20" : "hover:bg-muted"
                      }`}
                    >
                    <Avatar className="h-10 w-10 cursor-pointer" onClick={(e) => { e.stopPropagation(); router.push(`/profile?username=${user.username}`) }}>
                        <AvatarImage src={`${apiEndpoints.uploads}/${user.avatar}`} />
                        <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                        <p className="font-medium text-foreground truncate cursor-pointer hover:text-primary" onClick={(e) => { e.stopPropagation(); router.push(`/profile?username=${user.username}`) }}>{user.username}</p>
                          {user.unread_count && user.unread_count > 0 && (
                            <span className="bg-primary text-primary-foreground text-xs rounded-full px-2 py-1 min-w-[20px] text-center">
                              {user.unread_count}
                            </span>
                          )}
                        </div>
                        {user.last_message && (
                          <p className="text-sm text-muted-foreground truncate">{user.last_message}</p>
                        )}
                      </div>
                    </div>
                  ))}

                  {users.length === 0 && (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground">Foydalanuvchilar topilmadi</p>
                    </div>
                  )}
                </div>
                <div className="p-4 text-center">
                  <Button variant="outline" size="sm" onClick={() => loadUsers(true)}>
                    Update
                  </Button>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Chat Area - Mobile Responsive */}
          <Card className={`lg:col-span-2 ${selectedUser ? 'block' : 'hidden lg:block'}`}>
            {selectedUser ? (
              <>
                <CardHeader className="border-b">
                  <div className="flex items-center space-x-3">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="lg:hidden p-2"
                      onClick={() => setSelectedUser(null)}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={`${apiEndpoints.uploads}/${selectedUser.avatar}`} />
                      <AvatarFallback>{selectedUser.username[0].toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <h3 className="font-medium text-foreground">{selectedUser.username}</h3>
                      <div className="flex items-center space-x-2">
                        <div className={`w-2 h-2 rounded-full ${selectedUser.is_online ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                        <p className="text-sm text-muted-foreground">
                          {selectedUser.is_online ? 'Onlayn' : selectedUser.last_seen ? `Oxirgi: ${new Date(selectedUser.last_seen).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}` : 'Offline'}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-0 flex flex-col h-[500px]">
                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4" style={{ maxHeight: '400px' }}>
                    <div className="space-y-4">
                      {messages.length > 0 && (
                        <div className="text-center">
                          <Button variant="outline" size="sm" onClick={() => loadMessages(true)}>
                            Update
                          </Button>
                        </div>
                      )}
                      {messages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex ${message.sender_id === currentUser.id ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[70%] rounded-lg px-4 py-2 ${
                              message.sender_id === currentUser.id
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-foreground"
                            }`}
                          >
                            <p className="text-sm">{message.message}</p>
                            <p
                              className={`text-xs mt-1 ${
                                message.sender_id === currentUser.id
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {new Date(message.created_at).toLocaleTimeString("uz-UZ", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  </div>

                  {/* Message Input */}
                  <div className="border-t p-4">
                    <form onSubmit={sendMessage} className="flex space-x-2">
                      <Input
                        placeholder="Xabar yozing..."
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        className="flex-1"
                      />
                      <Button type="submit" disabled={!newMessage.trim()}>
                        <Send className="h-4 w-4" />
                      </Button>
                    </form>
                  </div>
                </CardContent>
              </>
            ) : (
              <CardContent className="flex items-center justify-center h-[500px]">
                <div className="text-center">
                  <p className="text-muted-foreground mb-4">Suhbatni boshlash uchun foydalanuvchini tanlang</p>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
