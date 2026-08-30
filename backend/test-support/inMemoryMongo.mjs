import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

let mongod = null;

export async function startInMemoryMongo() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}

export async function stopInMemoryMongo() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}
