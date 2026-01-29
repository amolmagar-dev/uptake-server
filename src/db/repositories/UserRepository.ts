/**
 * User Repository
 * Handles all database operations for User entity
 */

import { prisma } from "../client.js";
import type { User } from "@prisma/client";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
  role?: string;
}

export interface UpdateUserInput {
  email?: string;
  password?: string;
  name?: string;
  role?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

class UserRepository {
  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  /**
   * Find user by ID and return profile (without password)
   */
  async findProfileById(id: string): Promise<UserProfile | null> {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, role: true },
    });
    return user;
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  }

  /**
   * Get all users
   */
  async findAll(): Promise<User[]> {
    return prisma.user.findMany({
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Create a new user
   */
  async create(data: CreateUserInput): Promise<User> {
    const hashedPassword = bcrypt.hashSync(data.password, 10);
    return prisma.user.create({
      data: {
        id: uuidv4(),
        email: data.email,
        password: hashedPassword,
        name: data.name,
        role: data.role || "viewer",
      },
    });
  }

  /**
   * Update user
   */
  async update(id: string, data: UpdateUserInput): Promise<User> {
    const updateData: Partial<User> = { ...data };
    if (data.password) {
      updateData.password = bcrypt.hashSync(data.password, 10);
    }
    return prisma.user.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Delete user
   */
  async delete(id: string): Promise<void> {
    await prisma.user.delete({ where: { id } });
  }

  /**
   * Verify user password
   */
  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compareSync(password, user.password);
  }

  /**
   * Check if user exists by email
   */
  async existsByEmail(email: string): Promise<boolean> {
    const count = await prisma.user.count({ where: { email } });
    return count > 0;
  }

  /**
   * Create default admin user if not exists
   */
  async createDefaultAdmin(email: string, password: string): Promise<void> {
    const exists = await this.existsByEmail(email);
    if (!exists) {
      await this.create({
        email,
        password,
        name: "Administrator",
        role: "admin",
      });
      console.log(`Created default admin user: ${email}`);
    }
  }
}

export const userRepository = new UserRepository();
