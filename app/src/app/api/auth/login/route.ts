import { NextResponse } from "next/server";
import { createHash } from "crypto";

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    const adminUser = process.env.ADMIN_USER || "admin";
    const adminPassword = process.env.ADMIN_PASSWORD || "linker2026";

    if (username !== adminUser || password !== adminPassword) {
      return NextResponse.json(
        { error: "Credenciales incorrectas" },
        { status: 401 }
      );
    }

    // Create session hash from password
    const sessionHash = createHash("sha256")
      .update(adminPassword)
      .digest("hex");

    const response = NextResponse.json({ success: true });

    response.cookies.set("lk-session", sessionHash, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: "Error en el servidor" },
      { status: 500 }
    );
  }
}
