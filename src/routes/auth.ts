import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import db from "../config/database.js";
import { generateToken, authenticateToken } from "../middleware/auth.js";
import { User, UserProfile } from "../types/database.js";

const router = Router();

// Login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: " and password are required" });
      return;
    }

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as User | undefined;

    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = generateToken(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Register
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existingUser) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    db.prepare(
      `
      INSERT INTO users (id, email, password, name, role)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(userId, email, hashedPassword, name || email.split("@")[0]!, "viewer");

    const token = generateToken(userId);

    res.status(201).json({
      token,
      user: {
        id: userId,
        email,
        name: name || email.split("@")[0]!,
        role: "viewer",
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

// Get current user
router.get("/me", authenticateToken, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

// Update profile
router.put("/profile", authenticateToken, async (req: Request, res: Response) => {
  try {
    const { name, currentPassword, newPassword } = req.body;
    const userId = req.user!.id;

    if (newPassword) {
      if (!currentPassword) {
        res.status(400).json({ error: "Current password is required to change password" });
        return;
      }

      const user = db.prepare("SELECT password FROM users WHERE id = ?").get(userId) as Pick<User, 'password'>;
      const validPassword = await bcrypt.compare(currentPassword, user.password);

      if (!validPassword) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      db.prepare("UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
        hashedPassword,
        userId
      );
    }

    if (name) {
      db.prepare("UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(name, userId);
    }

    const updatedUser = db.prepare("SELECT id, email, name, role FROM users WHERE id = ?").get(userId) as UserProfile;
    res.json({ user: updatedUser });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ error: "Profile update failed" });
  }
});

export default router;
