import { Router, Request, Response } from "express";
import { generateToken, authenticateToken } from "../middleware/auth.js";
import { userRepository } from "../db/index.js";

const router = Router();

// Login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const user = await userRepository.findByEmail(email);

    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const validPassword = await userRepository.verifyPassword(user, password);
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

    const existsAlready = await userRepository.existsByEmail(email);
    if (existsAlready) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const user = await userRepository.create({
      email,
      password,
      name: name || email.split("@")[0]!,
      role: "viewer",
    });

    const token = generateToken(user.id);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
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

      const user = await userRepository.findById(userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const validPassword = await userRepository.verifyPassword(user, currentPassword);
      if (!validPassword) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }

      await userRepository.update(userId, { password: newPassword });
    }

    if (name) {
      await userRepository.update(userId, { name });
    }

    const updatedUser = await userRepository.findProfileById(userId);
    res.json({ user: updatedUser });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ error: "Profile update failed" });
  }
});

export default router;
