import mongoose from "mongoose";

const studentSchema = new mongoose.Schema({
  websiteUserId: { type: String, unique: true },
  name: String,
  email: String
});

export default mongoose.model("Student", studentSchema);
