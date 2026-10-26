import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const filePath = path.join(process.cwd(), '..', 'exports', 'MIFOS_Stock_Customers_by_Bill.xlsx');
    
    // Check if the pre-generated file exists
    if (fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath);
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="MIFOS_Stock_Customers_by_Bill.xlsx"'
        }
      });
    }

    return NextResponse.json({ error: 'Excel file not found. Please run export script.' }, { status: 404 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
