import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, readFileSync } from "fs";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Todos los campos son requeridos" },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: "La nueva contrasena debe tener al menos 6 caracteres" },
        { status: 400 }
      );
    }

    const adminPassword = process.env.ADMIN_PASSWORD || "linker2026";

    if (currentPassword !== adminPassword) {
      return NextResponse.json(
        { error: "La contrasena actual es incorrecta" },
        { status: 401 }
      );
    }

    // Update .env file
    const envPath = path.resolve(process.cwd(), ".env");
    try {
      let envContent = readFileSync(envPath, "utf-8");

      if (envContent.includes("ADMIN_PASSWORD=")) {
        envContent = envContent.replace(
          /ADMIN_PASSWORD=.*/,
          `ADMIN_PASSWORD=${newPassword}`
        );
      } else {
        envContent += `\nADMIN_PASSWORD=${newPassword}`;
      }

      writeFileSync(envPath, envContent);

      // Update runtime env var
      process.env.ADMIN_PASSWORD = newPassword;

      return NextResponse.json({
        success: true,
        message: "Contrasena actualizada. Reinicia la app para que tome efecto completo.",
      });
    } catch (fileError) {
      console.error("Error writing .env:", fileError);
      return NextResponse.json(
        { error: "No se pudo actualizar el archivo .env. Cambialo manualmente." },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("POST /api/config/change-password error:", error);
    return NextResponse.json(
      { error: "Error al cambiar la contrasena" },
      { status: 500 }
    );
  }
}
