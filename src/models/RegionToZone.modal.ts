import mongoose, { Document, Schema } from 'mongoose';

interface IRegionToZone extends Document {
    region: string;
    zone: string;
    createdAt: Date;
    updatedAt: Date;
}

const regionToZoneSchema: Schema<IRegionToZone> = new Schema({
    region: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    zone: {
        type: String,
        required: true,
        trim: true,
    },
}, { timestamps: true });

const RegionToZone = mongoose.model<IRegionToZone>('RegionToZone', regionToZoneSchema);

export default RegionToZone;
